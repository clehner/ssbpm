var createSsbpm = require('../')
var ssbKeys = require('ssb-keys')
var tape = require('tape')

var createSbot = require('scuttlebot')
  .use(require('scuttlebot/plugins/master'))

tape('test ssbpm api', function (t) {

  var aliceKeys = ssbKeys.generate()
  var sbot = createSbot({
    temp: 'test-ssbpm', timeout: 200,
    allowPrivate: true,
    keys: aliceKeys
  })

  createSsbpm(sbot, function (err, ssbpm) {
    if (err) throw err

    // publish a package
    var module = {}
    ssbpm.publish(module, function (err, moduleId) {
      if (err) throw err

      // load the package from another client
      createSbot.createClient({keys: aliceKeys})
      (sbot.getAddress(), function (err, rpc) {
        if (err) throw err

        createSsbpm(rpc, function (err, ssbpmA) {
          if (err) throw err

          ssbpmA.require(moduleId, function (err, moduleA) {

            // the packages are the same
            t.equal(moduleA && moduleA.type, "package")

            sbot.close(true)
            t.end()
          })
        })
      })
    })
  })
})
