#!/usr/bin/env node

var argv = require('minimist')(process.argv.slice(2), {
  alias: {
    save: 'S',
    force: 'f',
    version: 'v',
    help: 'h'
  }
})
var ref = require('ssb-ref')
var ssbKeys = require('ssb-keys')
var SSBPM = require('.')
var path = require('path')
var config  = require('ssb-config/inject')(process.env.ssb_appname)

function createSsbClient(cb) {
  var keys = ssbKeys.loadOrCreateSync(path.join(config.path, 'secret'))
  require('ssb-client')(keys, {
    port: config.port,
    host: config.host || 'localhost'
  }, cb)
}

function usage(status) {
  console.log([
    '',
    '  ssbpm <command> [options]',
    '',
    '  Options:',
    '',
    '    -h, --help     Output this message',
    '    -v, --version  Output version information',
    '    -s, --save     Update package.json after the operation',
    '    -f, --force    Ignore warnings',
    '',
    '  Commands:',
    '',
    '    install <hash>       Install a package',
    '    publish [directory]  Publish a package',
    ''].join('\n'))
  process.exit(status)
}

function version() {
  console.log(require('./package.json').version)
  process.exit(0)
}

if (argv.version)
  version()
else if (argv._.length == 0 || argv.help)
  usage(0)
else if (argv._[0] == 'install')
  install(argv._.slice(1), argv)
else if (argv._[0] == 'publish')
  publish(argv._.slice(1), argv)
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

  createSsbClient(function (err, sbot) {
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
  if (args.length > 1)
    return console.error('Publish one package at a time')

  var path = args[0] || '.'

  createSsbClient(function (err, sbot) {
    if (err) throw err

    var ssbpm = new SSBPM(sbot)
    ssbpm.publishFromFs(path, {
      force: opt.force,
      save: opt.save
    }, function (err, hash) {
      if (err) throw err

      console.log(hash)
      sbot.close(true)
    })
  })
}
