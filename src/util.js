'use strict'

const bitcoinjs = require('bitcoinjs-lib');
const BigInteger = require('bigi');
const crypto = require('crypto');

/*
 * Given a host:port string, split it into
 * a host and port
 *
 * @param hostport (String) the host:port
 *
 * Returns an object with:
 *      .host
 *      .port
 */
export function splitHostPort(hostport) {

   let host = hostport;
   let port = 80;
   const parts = hostport.split(':');
   if (parts.length > 1) {
      host = parts[0];
      port = parts[1];
   }

   return {'host': host, 'port': port};
}


/*
 * Get a *uncompressed* public key (hex) from private key
 */
export function getPubkeyHex(privkey_hex) {
   let privkey = BigInteger.fromBuffer( decodePrivateKey(privkey_hex) );
   let public_key = new bitcoinjs.ECPair(privkey);
   const public_key_str = decompressPublicKey(public_key.getPublicKeyBuffer().toString('hex'));
   return public_key_str;
}


/* 
 * Get the address of a public key
 *
 * @param pubkey_hex: the public key as a hex string
 */
export function publicKeyToAddress(pubkey_hex) {
    let ec = bitcoinjs.ECPair.fromPublicKeyBuffer( Buffer.from(pubkey_hex, 'hex') );
    return ec.getAddress();
}


/*
 * Convert a public key to its uncompressed format
 *
 * @param pubkey (string) the public key as a hex string
 *
 * Returns a string that encodes the uncompressed public key
 */
export function decompressPublicKey(pubkey_hex) {
   let pubk = bitcoinjs.ECPair.fromPublicKeyBuffer( Buffer.from(pubkey_hex, 'hex') );
   pubk.compressed = false;
   
   const public_key_str = pubk.getPublicKeyBuffer().toString('hex');
   return public_key_str;
}


/*
 * Hash raw data
 * @param payload_buffer (Buffer) the buffer to hash
 *
 * Return the sha256
 */
export function hashRawData( payload_buffer ) {
   const hash = crypto.createHash('sha256');

   hash.update(payload_buffer);
   
   return hash.digest('hex');
}


/*
 * Decode a hex string into a byte buffer.
 *
 * @param hex (String) a string of hex digits.
 *
 * Returns a buffer with the raw bytes
 */
export function decodeHexString( hex ) {
    const bytes = [];
    for(let i=0; i< hex.length-1; i+=2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return Buffer.from(bytes)
}


/*
 * Decode an ECDSA private key into a byte buffer
 * (compatible with Bitcoin's 'compressed' flag quirk)
 *
 * @param privkey_hex (String) a hex-encoded ECDSA private key on secp256k1; optionally ending in '01'
 *
 * Returns a Buffer with the private key data
 */
export function decodePrivateKey( privatekey_hex ) {
   if( privatekey_hex.length === 66 && privatekey_hex.slice(64, 66) === '01' ) {
       // truncate the '01', which is a hint to Bitcoin to expect a compressed public key
       privatekey_hex = privatekey_hex.slice(0, 64);
   }
   return decodeHexString(privatekey_hex);
}


// Gratefully borrowed with light modification from https://github.com/substack/json-stable-stringify/blob/master/index.js

var json = typeof JSON !== 'undefined' ? JSON : require('jsonify');

export function jsonStableSerialize(obj, opts) {
    if (!opts) opts = {};
    if (typeof opts === 'function') opts = { cmp: opts };
    var space = opts.space || '';
    if (typeof space === 'number') space = Array(space+1).join(' ');
    var cycles = (typeof opts.cycles === 'boolean') ? opts.cycles : false;
    var replacer = opts.replacer || function(key, value) { return value; };

    var cmp = opts.cmp && (function (f) {
        return function (node) {
            return function (a, b) {
                var aobj = { key: a, value: node[a] };
                var bobj = { key: b, value: node[b] };
                return f(aobj, bobj);
            };
        };
    })(opts.cmp);

    var seen = [];
    return (function jsonStableSerialize (parent, key, node, level) {
        var indent = space ? ('\n' + new Array(level + 1).join(space)) : '';
        var colonSeparator = space ? ': ' : ':';

        if (node && node.toJSON && typeof node.toJSON === 'function') {
            node = node.toJSON();
        }

        node = replacer.call(parent, key, node);

        if (node === undefined) {
            return;
        }
        if (typeof node !== 'object' || node === null) {
            return json.stringify(node);
        }
        if (isArray(node)) {
            var out = [];
            for (var i = 0; i < node.length; i++) {
                var item = jsonStableSerialize(node, i, node[i], level+1) || json.stringify(null);
                out.push(indent + space + item);
            }
            return '[' + out.join(',') + indent + ']';
        }
        else {
            if (seen.indexOf(node) !== -1) {
                if (cycles) return json.stringify('__cycle__');
                throw new TypeError('Converting circular structure to JSON');
            }
            else seen.push(node);

            var keys = objectKeys(node).sort(cmp && cmp(node));
            var out = [];
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                var value = jsonStableSerialize(node, key, node[key], level+1);

                if(!value) continue;

                var keyValue = json.stringify(key)
                    + colonSeparator
                    + value;
                ;
                out.push(indent + space + keyValue);
            }
            seen.splice(seen.indexOf(node), 1);
            return '{' + out.join(',') + indent + '}';
        }
    })({ '': obj }, '', obj, 0);
};

var isArray = Array.isArray || function (x) {
    return {}.toString.call(x) === '[object Array]';
};

var objectKeys = Object.keys || function (obj) {
    var has = Object.prototype.hasOwnProperty || function () { return true };
    var keys = [];
    for (var key in obj) {
        if (has.call(obj, key)) keys.push(key);
    }
    return keys;
};

