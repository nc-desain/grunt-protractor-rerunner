/*
 * grunt-protractor-runner
 * https://github.com/teerapap/grunt-protractor-runner
 *
 * Copyright (c) 2013 Teerapap Changwichukarn
 * Licensed under the MIT license.
 */

'use strict';

var util = require('util');
var path = require('path');
var fs = require('fs');
var split = require('split');
var through2 = require('through2');

module.exports = function(grunt) {

  function yell(thing) {
    grunt.log.writeln(thing);
    grunt.verbose.writeln(thing);
    console.log(thing);
  }

  grunt.registerMultiTask('protractor', 'A grunt task to run protractor.', function() {

    // '.../node_modules/protractor/lib/protractor.js'
    var protractorMainPath = require.resolve('protractor');
    // '.../node_modules/protractor/bin/protractor'
    var protractorBinPath = path.resolve(protractorMainPath, '../../bin/protractor');
    // '.../node_modules/protractor/bin/webdriver-manager'
    var webdriverManagerPath = path.resolve(protractorMainPath, '../../bin/webdriver-manager');

    // Merge task-specific and/or target-specific options with these defaults.
    var opts = this.options({
      keepAlive: false,
      noColor: false,
      debug: false,
      nodeBin: 'node',
      args: {},
      output: false,
      outputOptions: {},
      webdriverManagerUpdate: false
    });

    // configFile is a special property which need not to be in options{} object.
    if (!grunt.util._.isUndefined(this.data.configFile)) {
      opts.configFile = this.data.configFile;
    }

    grunt.verbose.writeln("Options: " + util.inspect(opts));
    yell( "Options: " + util.inspect(args));
    //Grab specs from config file to put on the command line
    var specs = [];
    if (!grunt.util._.isUndefined(opts.configFile)) {
      specs = require(path.join(process.cwd(), opts.configFile)).specs
              //.map((path)=>path.replace('../..', '.tmp/e2e'));
              .map(function(path){return path.replace('../..', '.tmp/e2e');});
    }
    //merge the command-line specs and the specs from the config file
    opts.args.specs = grunt.util._.compact(grunt.util._.union(opts.args.specs, specs));
    grunt.verbose.writeln('Specs are: ' + util.inspect(opts.args.specs));
    yell("SPECS ARE: " + util.inspect(opts.args.specs));

    var keepAlive = opts['keepAlive'];
    var strArgs = ["seleniumAddress", "seleniumServerJar", "seleniumPort", "baseUrl", "rootElement", "browser", "chromeDriver", "chromeOnly", "directConnect", "sauceUser", "sauceKey", "sauceSeleniumAddress", "framework", "frameworkPath", "suite", "beforeLaunch", "onPrepare", "webDriverProxy"];
    var listArgs = ["specs", "exclude"];
    var boolArgs = ["includeStackTrace", "verbose"];
    var objectArgs = ["params", "capabilities", "cucumberOpts", "mochaOpts"];

    var cmd = [protractorBinPath];
    if (!grunt.util._.isUndefined(opts.configFile)){
      cmd.push(opts.configFile);
    }
    var args = process.execArgv.concat(cmd);
    if (opts.noColor){
      args.push('--no-jasmineNodeOpts.showColors');
    }
    if (!grunt.util._.isUndefined(opts.debug) && opts.debug === true){
      args.splice(1,0,'debug');
    }

    // Iterate over all supported arguments.
    strArgs.forEach(function(a) {
      if (a in opts.args || grunt.option(a)) {
        args.push('--'+a, grunt.option(a) || opts.args[a]);
      }
    });
    listArgs.forEach(function(a) {
      if (a in opts.args || grunt.option(a)) {
        args.push('--'+a,  grunt.option(a) || opts.args[a].join(","));
      }
    });
    boolArgs.forEach(function(a) {
      if (a in opts.args || grunt.option(a)) {
        args.push('--'+a);
      }
    });

    // Convert [object] to --[object].key1 val1 --[object].key2 val2 ....
    objectArgs.forEach(function(a) {
      (function convert(prefix, obj, args) {
        if (typeof obj === 'string'){
          obj = JSON.parse(obj);
        }
        for (var key in obj) {
          var val = obj[key];
          var type = typeof obj[key];
          if (type === "object") {
            if (Array.isArray(val)) {
              // Add duplicates --[object].key val1 --[object].key val2 ...
              for (var i=0;i<val.length;i++) {
                args.push(prefix+"."+key, val[i]);
              }
            } else {
              // Dig deeper
              convert(prefix+"."+key, val, args);
            }
          } else if (type === "undefined" || type === "function") {
            // Skip these types
          } else if (type === "boolean") {
            // Add --[object].key
            if (val) {
              args.push(prefix+"."+key);
            } else {
              args.push("--no"+prefix.substring(1)+"."+key);
            }
          } else {
            // Add --[object].key value
            args.push(prefix+"."+key, val);
          }
        }
      })("--" + a, grunt.option(a) || opts.args[a], args);
    });

    var testAttempt = 1;

    var failedSpecParser = function(output) {
      if (output == undefined) output = '';
      var match = null;
      var CUCUMBERJS_TEST = /^\d+ scenarios?/m;
      var failedSpecs = {};

      if (CUCUMBERJS_TEST.test(output)) {
        var FAILED_LINES = /(.*?):\d+ # Scenario:.*/g;
        while (match = FAILED_LINES.exec(output)) { // eslint-disable-line no-cond-assign
          failedSpecs[match[1]] = true;
        }
      } else {
        var FAILED_LINES = /at (?:\[object Object\]|Object)\.<anonymous> \((([A-Za-z]:\\)?.*?):.*\)/g
        while (match = FAILED_LINES.exec(output)) { // eslint-disable-line no-cond-assign
          // windows output includes stack traces from
          // webdriver so we filter those out here
          if (!/node_modules/.test(match[1])) {
            failedSpecs[match[1]] = true;
          }
        }
      }

      return Object.keys(failedSpecs);
    };

    // Spawn protractor command
    var done = this.async();
    var startProtractor = function(){
      grunt.verbose.writeln("Spawn node with arguments: " + args.join(" "));
      yell("NODE SPAWNING WITH ARGS" + util.inspect(args));

      //store the output to a variable so we can parse it if there's an error
      var output = '';

      var child = grunt.util.spawn({
          cmd: opts.nodeBin,
          args: args,
          opts: {
            stdio:'pipe'
          }
        },
        function(error, result, code) {
          if (error) {
            grunt.log.error(String(result));
            if(code === 1 && keepAlive && (++testAttempt <= 3) ) {
              // Test fails but do not want to stop the grunt process.
              grunt.log.oklns("Test failed but keep the grunt process alive. Retry failed specs.");
              //let failedSpecs = failedSpecParser(output).map((failedSpec)=>failedSpec.replace(path.join(process.cwd(), 'test'), '.tmp'));
              var failedSpecs = failedSpecParser(output).map(function(failedSpec){return failedSpec.replace(path.join(process.cwd(), 'test'), '.tmp');});
              grunt.log.writeln('Re-running tests: test attempt ' + testAttempt);
              grunt.log.writeln('Re-running the following test files:\n' + failedSpecs.join('\n'));
              yell("attempt" + testAttempt + " rerunning " + util.inspect(failedSpecs));

              if (args.indexOf('--specs') != -1)
                args.splice(args.indexOf('--specs'), 2); //delete old specs from array
              args.push('--specs', failedSpecs.join(',')); //add failed specs

              yell("NEW ARGS " + util.inspect(args));

              return startProtractor();
            } else {
              // Test fails and want to stop the grunt process,
              // or protractor exited with other reason.
              grunt.warn('Tests failed, protractor exited with code: '+code, code);
            }
          }
          done();
        }
      );
      try {
        process.stdin.pipe(child.stdin);
      }
      catch (e) {
        grunt.log.debug("Non-fatal: stdin cannot be piped in this shell");
      }
      child.stdout.pipe(process.stdout);
      //keep output for parsing in case of failure
      //child.stdout.on('data', (buffer) => output+=buffer.toString());
      child.stdout.on('data', function(buffer){output+=buffer.toString()});
      child.stderr.pipe(process.stderr);

      // Write the result in the output file
      if (!grunt.util._.isUndefined(opts.output) && opts.output !== false) {

        grunt.log.writeln("Output test result to: " + opts.output);

        grunt.file.mkdir(path.dirname(opts.output));

        child.stdout
          .pipe(split())
          .pipe(through2(function (chunk, encoding, callback) {
            if ((/^Using the selenium server at/).test(chunk.toString())) {
              // skip
            }
            else {
              this.push(chunk + '\n');
            }
            callback();
          }))
          .pipe(fs.createWriteStream(opts.output, opts.outputOptions));
      }
    };

    if (opts.webdriverManagerUpdate) {
      grunt.log.writeln('webdriver-manager path: ' + webdriverManagerPath);
      grunt.util.spawn({
        cmd: opts.nodeBin,
        args: [webdriverManagerPath, 'update'],
        opts: {
          stdio: 'inherit'
        }
      }, startProtractor);
    } else {
      startProtractor();
    }
  });

};
