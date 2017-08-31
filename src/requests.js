'use strict'    

import {
   CORE_ERROR_SCHEMA,
} from './schemas';

const assert = require('assert');
const Ajv = require('ajv');
const http = require('http');
const Promise = require('promise');
const jsontokens = require('jsontokens');
const urlparse = require('url');

/*
 * Helper method to validate a JSON response
 * against a schema.  Returns the validated object
 * on success, and throw an exception on error.
 */
function validateJSONResponse(resp, result_schema) {

   const ajv = new Ajv();
   if (result_schema) {
      try {
         const valid = ajv.validate(result_schema, resp);
         assert(valid);
         return resp;
      }
      catch(e) {
         try {
            // error message
            const valid = ajv.validate(CORE_ERROR_SCHEMA, resp);
            assert(valid);
            return resp;
         }
         catch(e2) {
            console.log("Failed to validate with desired schema");
            console.log(e.stack);
            console.log("Failed to validate with error schema");
            console.log(e2.stack);
            console.log("Desired schema:");
            console.log(result_schema);
            console.log("Parsed message:");
            console.log(resp);
            throw new Error("Invalid core message");
         }
      }
   }
   else {
      return resp;
   }
}


/*
 * Helper method to issue an HTTP request.
 * @param options (Object) set of HTTP request options
 * @param result_schema (Object) JSON schema of the expected result
 *
 * Returns a structured JSON response on success, conformant to the result_schema.
 * Returns plaintext on success if the content-type is application/octet-stream
 * Returns a structured {'error': ...} object on client-side error
 * Throws on server-side error
 */
export function httpRequest(options, result_schema, body) {

    if (body) {
       options['body'] = body;
    }

    if (!options['headers']) {
       options['headers'] = {};
    }

    options['headers']['Origin'] = 'http://localhost:8888'

    const url = `http://${options.host}:${options.port}${options.path}`;
    return fetch(url, options)
    .then((response) => {

        if(response.status >= 500) {
           throw new Error(response.statusText);
        }

        if(response.status === 404) {
           return {'error': 'No such file or directory', 'errno': 'ENOENT'};
        }

        if(response.status === 403) {
           return {'error': 'Access denied', 'errno': 'EACCES'};
        }

        if(response.status === 401) {
           return {'error': 'Invalid request', 'errno': 'EINVAL'};
        }

        if(response.status === 400) {
           return {'error': 'Operation not permitted', 'errno': 'EPERM'};
        }

        let resp = null;
        if (response.headers.get('content-type') === 'application/json') {
           return response.json()
           .then((resp) => {
              return validateJSONResponse(resp, result_schema);
           });
        }
        else {
           return response.text();
        }
    });
}


