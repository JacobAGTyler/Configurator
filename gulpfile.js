const { src, dest, series } = require('gulp');
const fs = require('fs');
const yaml = require('js-yaml');
const gyaml = require('gulp-yaml');
const replace = require('gulp-replace');
const rename = require("gulp-rename");
const scan = require('gulp-scan');
const AWS = require('aws-sdk');

let fileContents = fs.readFileSync('replacements.yml', 'utf8');
let replacements = yaml.safeLoad(fileContents);


function buildReplacement() {
    let parameters = [];

    replacements['placeholders'].forEach(buildParamPath)

    function buildParamPath(replacement_string, index) {
        parameters[index] = [];
        parameters[index]['string'] = '<<' + replacement_string.toUpperCase() + '>>';
        parameters[index]['path'] = '/' + replacements['application'];
        parameters[index]['path'] += '/' + replacements['environment'];
        parameters[index]['path'] += '/' + replacement_string.toLowerCase();
    }

    return parameters;
}

function getParameterPaths() {
    let parameters = buildReplacement();

    function pathExtractor(parameterArray) {
        parameterArray = parameterArray.reduce(function (acc, obj, index) {
            acc[index] = obj['path'];
            return acc
        }, {})

        return Object.values(parameterArray);
    }

    return pathExtractor(parameters);
}

function retrieveParameters(cb) {

    let paths = getParameterPaths();

    let params = {
        Names: paths,
        WithDecryption: true
    };

    let paramPromise = new AWS.SSM({'region': 'eu-west-1'});
    paramPromise.getParameters(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else {
            let replace_params = data['Parameters'];

            fs.writeFileSync('replacement_params.yml', yaml.safeDump(replace_params, {
                'styles': {
                    '!!null': 'canonical' // dump null as ~
                },
                'sortKeys': true        // sort object keys
            }));
        }
    });

    return cb();
}


function createParameters(cb) {
    let paramFileContents = fs.readFileSync('variables.yml', 'utf8');
    let parameters = yaml.safeLoad(paramFileContents);
    let paramPromise = new AWS.SSM({'region': 'eu-west-1'});

    parameters.forEach(function (parameter) {
        paramPromise.putParameter(parameter, function(err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else     console.log(data);           // successful response
        });
    });

    return cb();
}

function findParamters(cb) {
    let stream = src('config/*.default.php');
    let variables = [];

    return stream.pipe(
        scan({ term: /<<[A-Z0-9_]+>>/g, fn: function (match) {
            let path = '/' + replacements['application'];
            path += '/' + replacements['environment'];
            path += '/' + match.replace('<<', '').replace('>>', '').toLowerCase();

            let obj = {
                Name: path,
                Value: match,
                Type: 'string',
                Overwrite: true
            };

            try {
                if (fs.existsSync(path)) {
                    let fileContents = fs.readFileSync('variables.yml', 'utf8');
                }
                let variables = yaml.safeLoad(fileContents);
            } catch(err) {
                let variables = [];
            }

            function pushToArray ( variables, obj ) {
                var existingIds = variables.map((obj) => obj.Name);

                if (! existingIds.includes(obj.Name)) {
                    variables.push(obj);
                } else {
                    variables.forEach((element, index) => {
                        if (element.Name === obj.Name) {
                            variables[index] = obj;
                        };
                    });
                };
            };

            pushToArray (variables, obj);

            fs.writeFileSync('variables.yml', yaml.safeDump(variables, {
                'styles': {
                    '!!null': 'canonical' // dump null as ~
                },
                'sortKeys': true        // sort object keys
            }));
        }})
    );
}


function parseConfigFiles() {
    let stream = src('config/*.default.php');

    let replacementContents = fs.readFileSync('replacement_params.yml', 'utf8');
    let parameters = yaml.safeLoad(replacementContents);

    parameters.map(function replacePlaceholders(paramArray) {
        let search_key = paramArray['Name'].split('/')
        search_key = '<<' + search_key[3].toUpperCase() + '>>';
        stream.pipe(replace(search_key, paramArray['Value']));
    })

    return stream
        .pipe(rename(function (path) {
            path.basename = path.basename.replace('.default', '');
        }))
        .pipe(dest('config'));
}


exports.retrieve = retrieveParameters
exports.parse = parseConfigFiles
exports.create = createParameters
exports.find = findParamters
exports.default = series(retrieveParameters, parseConfigFiles)