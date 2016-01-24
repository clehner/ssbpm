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
      }, function (err, moduleA) {
        t.error(err, 'install to file system')

        t.equals(fs.existsSync(path.join(destDir, 'package.json')), false,
          'parent package.json not created')

        // load modules using node's require
        var example
        t.doesNotThrow(function () {
          example = require(path.join(destDir, 'node_modules', 'example-pkg'))
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
  }, function (err, moduleA) {
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
          'example-pkg': '*'
        },
        ssbpm: {
          dependencies: {
            'example-pkg': examplePkgId
          }
        }
      }, 'parent package.json updated with new dependency')

      t.end()
    })
  })
})

tape('republish package using save option', function (t) {
  var dir = path.join(sbotOpts.path, 'ssbpm-example',
    'node_modules', 'example-pkg')
  ssbpm.publishFromFs(dir, {
    save: true
  }, function (err, pkgId) {
    t.error(err, 'publish from file system')
    t.ok(ref.isMsg(pkgId), 'package is a message')

    var pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json')))
    t.deepEqual(pkg, {
      name: 'example-pkg',
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

tape('close ssb client connection', function (t) {
  sbot.close(true)
  t.end()
})
