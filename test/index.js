var SSBPM = require('../')
var ssbKeys = require('ssb-keys')
var tape = require('tape')
var path = require('path')
var ref = require('ssb-ref')

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

tape('publish a package and install it from another client', function (t) {

  var ssbpm = new SSBPM(sbot)

  // publish a package from a directory
  var srcPath = path.join(__dirname, './example')
  ssbpm.publishFromFs(srcPath, function (err, pkgId) {
    t.error(err, 'publish from file system')

    t.ok(ref.isMsg(pkgId), 'package is a message')

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

        // load modules using node's require
        var example
        t.doesNotThrow(function () {
          example = require(path.join(destDir, 'node_modules', 'example-pkg'))
        }, 'require a module of the example package')
        t.equal(example && example.increment(99), 100,
          'run code from the example package')

          /*
        // load module using ssbpm
        ssbpmA.require(pkgId, function (err, example) {
          t.error(err, 'load module using ssbpm require')
          */

          sbot.close(true)
          t.end()
          /*
        })
        */
      })
    })
  })
})
