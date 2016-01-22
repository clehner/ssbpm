#!/usr/bin/env node

var argv = require('minimist')(process.argv.slice(2), {
  alias: {
    save: 'S',
    help: 'h'
  }
})
var ref = require('ssb-ref')
var SSBPM = require('.')

function usage (status) {
  console.log('Install a package: ssbpm install {hash...}')
  console.log('Publish a package: ssbpm publish [directory]')
  process.exit(status)
}

if (argv._.length == 0 || argv.help)
  usage(0)
else if (argv._[0] == 'install')
  install(argv._.slice(1), argv._)
else if (argv._[0] == 'publish')
  publish(argv._.slice(1), argv._)
else
  usage(1)

function install(args, opt) {
  var msg = args[0]
  if (!msg)
    return console.error('Include a message ID of a package to install')
  if (args.length > 1)
    return console.error('Install one package a time')
  if (!ref.isMsg(msg))
    return console.error('Invalid message ID "' + msg + '"')

  require('ssb-client')(function (err, sbot) {
    if (err) throw err

    var ssbpm = new SSBPM(sbot)
    ssbpm.installToFs(msg, {
      save: opt.save
    }, function (err) {
      if (err) throw err
      sbot.close(true)
    })
  })
}

function publish(args, opt) {
  if (argv._.length > 2)
    return console.error('Publish one package at a time')

  var path = argv._[1] || '.'

  require('ssb-client')(function (err, sbot) {
    if (err) throw err

    var ssbpm = new SSBPM(sbot)
    ssbpm.publishFromFs(path, {
      save: opt.save
    }, function (err, hash) {
      if (err) throw err

      console.log(hash)
      sbot.close(true)
    })
  })
}
