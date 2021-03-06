import { promises as fs } from 'fs'
import path from 'path'
import process from 'process'
import generate from '@babel/generator'
import traverse from '@babel/traverse'
import { parse } from '@babel/parser'
import * as t from '@babel/types'

export default function resolveBuildConfig({ src, opts }) {
  return fs.readFile(src).then(buildConfig => {
    const defineConstantsProperties = []
    const patternsElements = []
    const sassResources = []
    const requires = []

    const patternVisitor = {
      noScope: true,
      ObjectExpression({ node }) {
        const properties = node.properties.map(property => {
          const { name } = property.key
          let { value } = property.value
          if (name == 'to') {
            const splitedPath = path
              .relative(process.cwd(), value)
              .split(path.sep)
            if (splitedPath[0].startsWith('dist')) {
              splitedPath[0] = `dist-${opts.project}`
              value = path.join(...splitedPath)
            }
          }
          // cloneNode
          return t.objectProperty(t.identifier(name), t.stringLiteral(value))
        })
        patternsElements.push(t.objectExpression(properties))
      }
    }
    const defineConstantVisitor = {
      noScope: true,
      ObjectProperty({ node }) {
        const { name } = node.key
        if (name.startsWith('__')) {
          const key = t.identifier(name)
          // 不是 JSON.stringify
          const value = t.callExpression(
            t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
            node.value.arguments.map(node => t.cloneNode(node, false, true))
          )
          defineConstantsProperties.push(t.objectProperty(key, value))
        }
      }
    }
    const sassResourceVisitor = {
      noScope: true,
      StringLiteral(_path) {
        sassResources.push(t.cloneNode(_path.node, false, true))
        _path.skip()
      },
      CallExpression(_path) {
        const sassFilepath = path.join(
          '/',
          ..._path.node.arguments.reduce((init, arg) => {
            if (t.isStringLiteral(arg)) {
              init.push(arg.value)
            }
            return init
          }, [])
        )
        sassResources.push(
          t.callExpression(
            t.memberExpression(t.identifier('path'), t.identifier('join')),
            [
              t.callExpression(
                t.memberExpression(
                  t.identifier('process'),
                  t.identifier('cwd')
                ),
                []
              ),
              t.stringLiteral(sassFilepath)
            ]
          )
        )
        _path.skip()
      }
    }

    const ast = parse(buildConfig.toString())
    const { body } = ast.program
    const configDeclaration = body.find(
      item =>
        item.type == 'VariableDeclaration' &&
        item.declarations[0].id.name == 'config'
    )
    traverse(configDeclaration, {
      noScope: true,
      Identifier(_path) {
        switch (_path.node.name) {
          case 'resource':
            _path.parentPath.traverse(sassResourceVisitor)
            break
          case 'patterns':
            _path.parentPath.traverse(patternVisitor)
            break
          case 'defineConstants':
            _path.parentPath.traverse(defineConstantVisitor)
            break
          default:
            break
        }
      }
    })

    const generatorOpts = {
      comments: false,
      // minified: true,
      jsescOption: {
        minimal: true
      }
    }

    const [sass] = sassResources
    if (sass == void 0 || t.isCallExpression(sass)) {
      sassResources.unshift(
        t.callExpression(
          t.memberExpression(t.identifier('path'), t.identifier('join')),
          [
            t.callExpression(
              t.memberExpression(t.identifier('process'), t.identifier('cwd')),
              []
            ),
            t.stringLiteral(opts.sass)
          ]
        )
      )
      requires.push('path', 'process')
    } else if (t.isStringLiteral(sass)) {
      sassResources.unshift(t.stringLiteral(opts.sass))
    }

    const resourceAst = t.arrayExpression(sassResources)
    const patternsAst = t.arrayExpression(patternsElements)
    const defineConstantsAst = t.objectExpression(
      (defineConstantsProperties.push(
        t.objectProperty(
          t.identifier('__PROJECT'),
          t.callExpression(
            t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
            [t.stringLiteral(opts.project)]
          )
        )
      ),
      defineConstantsProperties)
    )

    return {
      requires,
      patterns: generate(patternsAst, generatorOpts).code,
      resource: generate(resourceAst, generatorOpts).code,
      defineConstants: generate(defineConstantsAst, generatorOpts).code
    }
  })
}
