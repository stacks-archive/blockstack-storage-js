'use strict'

export const MUTABLE_DATUM_FILE_TYPE = 1;
export const MUTABLE_DATUM_DIR_TYPE = 2;

export const OP_BASE58CHECK_PATTERN = '^([123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+)$';
export const OP_ADDRESS_PATTERN = OP_BASE58CHECK_PATTERN;
export const OP_UUID_PATTERN = '^([0-9a-fA-F\-]+)$';
export const OP_HEX_PATTERN = '^([0-9a-fA-F]+)$';
export const OP_URLENCODED_NOSLASH_PATTERN = '^([a-zA-Z0-9\-_.~%]+)$';       // intentionally left out /
export const OP_URLENCODED_PATTERN = '^([a-zA-Z0-9\-_.~%/]+)$';
export const OP_URLENCODED_NOSLASH_OR_EMPTY_PATTERN = '^([a-zA-Z0-9\-_.~%]*)$'       // intentionally left out /, allow empty
export const OP_URLENCODED_OR_EMPTY_PATTERN = '^([a-zA-Z0-9\-_.~%/]*)$'
export const OP_PUBKEY_PATTERN = OP_HEX_PATTERN;
export const OP_BASE64_PATTERN = '(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})'

export const SUCCESS_FAIL_SCHEMA = {
   anyOf: [
      {
         type: 'object',
         properties: {
            status: {
               type: 'boolean'
            },
         },
      },
      {
         type: 'object',
         properties: {
            error: {
               type: 'string'
            },
         },
      },
   ],
};


export const MUTABLE_DATUM_SCHEMA_BASE_PROPERTIES = {
    type: {
        type: 'integer',
        minimum: MUTABLE_DATUM_FILE_TYPE,
        maximum: MUTABLE_DATUM_DIR_TYPE,
        optional: false,
    },
    owner: {
        type: 'string',
        pattern: OP_ADDRESS_PATTERN,
        optional: false,
    },
    uuid: {
        type: 'string',
        pattern: OP_UUID_PATTERN,
        optional: false,
    },
    version: {
        type: 'integer',
        optional: false,
    },
};

export const MUTABLE_DATUM_SCHEMA_HEADER_PROPERTIES = JSON.parse(JSON.stringify(MUTABLE_DATUM_SCHEMA_BASE_PROPERTIES));
MUTABLE_DATUM_SCHEMA_HEADER_PROPERTIES['data_hash'] = {
        type: 'string',
        pattern: OP_HEX_PATTERN,
};


export const MUTABLE_DATUM_DIRENT_SCHEMA = {
    type: 'object',
    strict: true,
    properties: {
        type: {
            type: 'integer',
            minimum: MUTABLE_DATUM_FILE_TYPE,
            maximum: MUTABLE_DATUM_DIR_TYPE,
            optional: false,
        },
        uuid: {
            type: 'string',
            pattern: OP_UUID_PATTERN,
            optional: false,
        },
        version: {
            type: 'integer',
            optional: false,
        }
    },
};

export const MUTABLE_DATUM_DIR_IDATA_SCHEMA = {
    type: 'object',
    strict: true,
    patternProperties: {
        OP_URLENCODED_NOSLASH_PATTERN: MUTABLE_DATUM_DIRENT_SCHEMA,
    },
};

export const MUTABLE_DATUM_FILE_SCHEMA_PROPERTIES = JSON.parse(JSON.stringify(MUTABLE_DATUM_SCHEMA_BASE_PROPERTIES));
MUTABLE_DATUM_FILE_SCHEMA_PROPERTIES['idata'] = {
        type: 'string',
        pattern: OP_BASE64_PATTERN, 
};

export const MUTABLE_DATUM_DIR_SCHEMA_PROPERTIES = JSON.parse(JSON.stringify(MUTABLE_DATUM_SCHEMA_BASE_PROPERTIES));
MUTABLE_DATUM_DIR_SCHEMA_PROPERTIES['idata'] = MUTABLE_DATUM_DIR_IDATA_SCHEMA;

export const MUTABLE_DATUM_INODE_SCHEMA = {
    type: 'object',
    strict: true,
    properties: MUTABLE_DATUM_SCHEMA_BASE_PROPERTIES,
};

export const MUTABLE_DATUM_INODE_HEADER_SCHEMA = {
    type: 'object',
    strict: true,
    properties: MUTABLE_DATUM_SCHEMA_HEADER_PROPERTIES,
};

export const MUTABLE_DATUM_FILE_SCHEMA = {
    type: 'object',
    strict: true,
    properties: MUTABLE_DATUM_FILE_SCHEMA_PROPERTIES,
};

export const MUTABLE_DATUM_DIR_SCHEMA = {
    type: 'object',
    strict: true,
    properties: MUTABLE_DATUM_DIR_SCHEMA_PROPERTIES,
};

export const MUTABLE_DATUM_PATH_INFO_SCHEMA = {
    type: 'object',
    strict: true,
    patternProperties: {
       OP_URLENCODED_PATTERN: {
          uuid: {
              type: 'string',
              optional: false,
              pattern: OP_UUID_PATTERN,
          },
          name: {
              type: 'string',
              optional: false,
              pattern: OP_URLENCODED_NOSLASH_PATTERN,
          },
          parent: {
              type: 'string',
              optional: false,
              pattern: OP_URLENCODED_PATTERN,
          },
          inode: {
             anyOf: [
                 MUTABLE_DATUM_DIR_SCHEMA,
                 MUTABLE_DATUM_FILE_SCHEMA,
                 MUTABLE_DATUM_INODE_HEADER_SCHEMA,
              ],
              optional: false,
          },
       },
    },
};

export const MUTABLE_DATUM_RESPONSE_SCHEMA = {
   type: 'object',
   strict: true,
   properties: {
      status: {
         type: 'boolean',
         optional: false,
      },
      file: MUTABLE_DATUM_FILE_SCHEMA,
      dir: MUTABLE_DATUM_DIR_SCHEMA,
      inode: MUTABLE_DATUM_INODE_SCHEMA,
   },
};

export const MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA = JSON.parse(JSON.stringify(MUTABLE_DATUM_RESPONSE_SCHEMA));
MUTABLE_DATUM_EXTENDED_RESPONSE_SCHEMA['path_info'] = MUTABLE_DATUM_PATH_INFO_SCHEMA;

export const DATASTORE_SCHEMA = {
    type: 'object',
    strict: true,
    properties: {
        type: {
            type: 'string',
            pattern: '([a-zA-Z0-9_]+)$',
            optional: false,
        },
        pubkey: {
            type: 'string',
            pattern: OP_PUBKEY_PATTERN,
            optional: false,
        },
        drivers: {
            type: 'array',
            items: {
                type: 'string',
            },
        },
        device_ids: {
            type: 'array',
            items: {
                'type': 'string',
            },
        },
        root_uuid: {
            type: 'string',
            pattern: OP_UUID_PATTERN,
        },
    },
};

export const DATASTORE_LOOKUP_PATH_ENTRY_SCHEMA = {
    type: 'object',
    strict: true,
    properties: {
        name: {
            type: 'string',
            pattern: OP_URLENCODED_NOSLASH_OR_EMPTY_PATTERN,
            optional: false,
        },
        uuid: {
            type: 'string',
            pattern: OP_UUID_PATTERN,
            optional: false,
        },
        parent: {
            type: 'string',
            pattern: OP_URLENCODED_OR_EMPTY_PATTERN,
            optional: false,
        },
        inode: MUTABLE_DATUM_DIR_SCHEMA,
    },
};


export const DATASTORE_LOOKUP_INODE_SCHEMA = {
    type: 'object',
    strict: true,
    properties: {
        name: {
            type: 'string',
            pattern: OP_URLENCODED_NOSLASH_OR_EMPTY_PATTERN,
            optional: false,
        },
        uuid: {
            type: 'string',
            pattern: OP_UUID_PATTERN,
            optional: false,
        },
        parent: {
            type: 'string',
            pattern: OP_URLENCODED_OR_EMPTY_PATTERN,
            optional: false,
        },
        inode: {
            anyOf: [
                MUTABLE_DATUM_DIR_SCHEMA,
                MUTABLE_DATUM_FILE_SCHEMA,
                MUTABLE_DATUM_INODE_HEADER_SCHEMA,
            ],
            optional: false
        },
    },
};


export const DATASTORE_LOOKUP_RESPONSE_SCHEMA = {
    type: 'object',
    strict: true,
    properties: {
        inode: {
            anyOf: [
                MUTABLE_DATUM_DIR_SCHEMA,
                MUTABLE_DATUM_FILE_SCHEMA,
                MUTABLE_DATUM_INODE_HEADER_SCHEMA,
            ],
            optional: false,
        },
        status: {
            type: 'boolean',
            optional: false,
        },
    },
};


export const DATASTORE_LOOKUP_EXTENDED_RESPONSE_SCHEMA = {
    type: 'object',
    strict: true,
    properties: {
        path_info: {
            type: 'object',
            patternProperties: {
                OP_URLENCODED_OR_EMPTY_PATTERN: DATASTORE_LOOKUP_INODE_SCHEMA,
            },
            optional: false,
        },
        inode_info: DATASTORE_LOOKUP_INODE_SCHEMA,
        status: {
            type: 'boolean',
            optional: false,
        },
    },
};

export const CORE_ERROR_SCHEMA = {
   type: 'object',
   strict: true,
   properties: {
      error: {
         type: 'string',
         optional: false,
      },
      errno: {
         type: 'integer',
      },
   },
};
