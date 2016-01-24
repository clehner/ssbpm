var SSBPM = require('../')
var ssbKeys = require('ssb-keys')
var tape = require('tape')
var path = require('path')
var ref = require('ssb-ref')
var fs = require('fs')

var createSbot = require('scuttlebot')
  .use(require('scuttlebot/plugins/master'))
  .use(require('scuttlebot/plugins/blobs'))

var aliceKeys = ssbKeys.generate()
var sbotOpts = {
  temp: 'test-ssbpm', timeout: 200,
  allowPrivate: true,
  keys: aliceKeys
}
var sbot = createSbot(sbotOpts)
var ssbpm = new SSBPM(sbot)

var examplePkgId

tape('publish a package and install it from another client', function (t) {

  var srcPath = path.join(__dirname, './example')
  var pkgJsonFilename = path.join(srcPath, 'package.json')
  var pkgJson = fs.readFileSync(pkgJsonFilename)

  // publish a package from a directory
  ssbpm.publishFromFs(srcPath, function (err, pkgId) {
    t.error(err, 'publish from file system')

    t.ok(ref.isMsg(pkgId), 'package is a message')
    examplePkgId = pkgId

    t.looseEqual(pkgJson, fs.readFileSync(pkgJsonFilename),
      'package.json is unchanged')

    // connect to the sbot from another client
    createSbot.createClient({keys: aliceKeys})
    (sbot.getAddress(), function (err, rpc) {
      t.error(err, 'connect a scuttlebot client')

      // create directory to install into
      // HACK: use sbot's temp directory
      var destDir = path.join(sbotOpts.path, 'ssbpm-example')

      // install the package into the destination directory
      var ssbpmA = new SSBPM(rpc)
      ssbpmA.installToFs(pkgId, {
        cwd: destDir
      }, function (err) {
        t.error(err, 'install to file system')

        t.equals(fs.existsSync(path.join(destDir, 'package.json')), false,
          'parent package.json not created')

        // load modules using node's require
        var example
        t.doesNotThrow(function () {
          example = require(path.join(destDir, 'node_modules', 'example'))
        }, 'require a module of the example package')
        t.equal(example && example.increment(99), 100,
          'run code from the example package')

        // load module using ssbpm
        ssbpmA.require(pkgId, function (err, example) {
          t.error(err, 'load module using ssbpm require')

          if (!example)
            t.fail('module did not load')
          else
            t.equal(example.increment(100), 101,
              'run code from the example package')

          t.end()
        })
      })
    })
  })
})

tape('install package using save option', function (t) {
  var destDir = path.join(sbotOpts.path, 'ssbpm-example-1')
  ssbpm.installToFs(examplePkgId, {
    cwd: destDir,
    save: true
  }, function (err) {
    t.error(err, 'install to file system')

    // parent dir's json should be created since the save option was used
    fs.readFile(path.join(destDir, 'package.json'), {
      encoding: 'utf8'
    }, function (err, data) {
      t.error(err, 'load parent package.json')
      var pkg
      try {
        pkg = JSON.parse(data)
      } catch(e) {
        t.error(e, 'parse parent package.json')
      }

      t.deepEqual(pkg, {
        dependencies: {
          'example': '*'
        },
        ssbpm: {
          dependencies: {
            'example': examplePkgId
          }
        }
      }, 'parent package.json updated with new dependency')

      t.end()
    })
  })
})

tape('republish package using save option', function (t) {
  var dir = path.join(sbotOpts.path, 'ssbpm-example',
    'node_modules', 'example')
  ssbpm.publishFromFs(dir, {
    save: true
  }, function (err, pkgId) {
    t.error(err, 'publish from file system')
    t.ok(ref.isMsg(pkgId), 'package is a message')

    var pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')))
    t.deepEqual(pkg, {
      name: 'example',
      ssbpm: {
        parent: pkgId,
        files: {
          'increment.js': '&DSe9Y+ARtob08O5HDBKlt+9qV3P5fUhioQ74Gt6ikrQ=.sha256',
          'index.js': '&i6F9oYlUl5a5NoljNpzEaiBYnPJzHXK7k95voNwNnrE=.sha256',
          'math.js': '&jItX2xxGJPfxLOEHI5yV7fVweRwVeAu8hSG7QLekwYw=.sha256'
        }
      }
    }, 'package.json updated with info about published package')

    t.end()
  })
})

tape('install a package with dependencies', function (t) {
  // copy the wrapper package into a temp directory so that we can
  // install the example package into it
  // since we don't know the example package's ID yet
  var wrapperPkgDir = path.join(sbotOpts.path, 'ssbpm-wrapper-pkg')
  var wrapperPkgJsonFilename = path.join(wrapperPkgDir, 'package.json')
  var wrapperSrcDir = path.join(__dirname, './wrapper')
  try {
    fs.mkdirSync(wrapperPkgDir)
    ;['index.js', 'package.json'].forEach(function (filename) {
      fs.writeFileSync(path.join(wrapperPkgDir, filename),
        fs.readFileSync(path.join(wrapperSrcDir, filename)))
    })
  } catch(e) {
    return t.end(e)
  }
  t.pass('copied wrapper package into temp dir')

  // install example pkg as a dependency of wrapper pkg
  ssbpm.installToFs(examplePkgId, {
    cwd: wrapperPkgDir,
    save: true
  }, function (err) {
    t.error(err, 'install example pkg into wrapper pkg dir')

    t.deepEqual(JSON.parse(fs.readFileSync(wrapperPkgJsonFilename)), {
      name: 'wrapper',
      dependencies: {
        example: '*'
      },
      ssbpm: {
        dependencies: {
          example: examplePkgId
        }
      }
    }, 'wrapper package.json updated with installed example pkg dependency')

    ssbpm.publishFromFs(wrapperPkgDir, {
      save: true
    }, function (err, wrapperPkgId) {
      t.error(err, 'publish from file system')

      t.deepEqual(JSON.parse(fs.readFileSync(wrapperPkgJsonFilename)), {
        name: 'wrapper',
        dependencies: {
          example: '*'
        },
        ssbpm: {
          parent: wrapperPkgId,
          files: {
            'index.js': '&18LxkIQx3IVlzg/lNQdATfd4f6Y4Y5o7rACKiakZSZQ=.sha256'
          },
          dependencies: {
            example: examplePkgId
          }
        }
      }, 'wrapper package.json updated with file hashes after publish')

      t.end()
    })
  })
})

tape.onFinish(function () {
  sbot.close(true)
})
