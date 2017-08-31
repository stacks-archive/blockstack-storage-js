'use strict'

export const OP_BASE58CHECK_PATTERN = "^([123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+)$";
export const OP_ADDRESS_PATTERN = OP_BASE58CHECK_PATTERN;
export const OP_UUID_PATTERN = "^([0-9a-fA-F\-]+)$";
export const OP_HEX_PATTERN = "^([0-9a-fA-F]+)$";
export const OP_URLENCODED_NOSLASH_PATTERN = "^([a-zA-Z0-9\-_.~%]+)$";
export const OP_URLENCODED_PATTERN = "^([a-zA-Z0-9\-_.~%/]+)$";
export const OP_URLENCODED_NOSLASH_OR_EMPTY_PATTERN = "^([a-zA-Z0-9\-_.~%]*)$";
export const OP_URLENCODED_OR_EMPTY_PATTERN = "^([a-zA-Z0-9\-_.~%/]*)$";
export const OP_PUBKEY_PATTERN = OP_HEX_PATTERN;
export const OP_BASE64_PATTERN_SECTION = "(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})";
export const OP_BASE64_PATTERN = "^(" + OP_BASE64_PATTERN_SECTION + ")$";
export const OP_TOMBSTONE_PATTERN = '^delete-([0-9]+):([a-zA-Z0-9\-_.~%#?&\\:/=]+)$';
export const OP_SIGNED_TOMBSTONE_PATTERN = '^delete-([0-9]+):([a-zA-Z0-9\-_.~%#?&\\:/=]+):(' + OP_BASE64_PATTERN_SECTION + ')$'
export const OP_DATASTORE_ID_CLASS = '[a-zA-Z0-9\-_.~%]';
export const OP_DATASTORE_ID_PATTERN = '^(' + OP_DATASTORE_ID_CLASS + '+)$';
export const OP_URI_TARGET_PATTERN = '^([a-z0-9+]+)://([a-zA-Z0-9\\-_.~%#?&\\\:/=]+)$'

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

export const ROOT_DIRECTORY_LEAF = 1;
export const ROOT_DIRECTORY_PARENT = 2;

export const ROOT_DIRECTORY_ENTRY_SCHEMA = {
    type: 'object',
    properties: {
        proto_version:  {
            type:  'integer',
            minimum:  1,
        },
        urls:  {
            type:  'array',
            values:  {
                type:  'string',
                pattern:  OP_URI_TARGET_PATTERN,
            },
        },
        data_hash:  {
            type:  'string',
            pattern:  OP_HEX_PATTERN,
        },
        timestamp:  {
            type:  'integer',
            minimum:  1,
        },
    },
    additionalProperties:  false,
    required:  [
        'proto_version',
        'urls',
        'data_hash'
    ],
};

export const ROOT_DIRECTORY_SCHEMA = {
    type:  'object',
    properties:  {
        proto_version:  {
            type:  'integer',
            minimum:  2,
        },
        type:  {
            type:  'integer',
            minimum:  ROOT_DIRECTORY_LEAF,
            maximum:  ROOT_DIRECTORY_PARENT,
        },
        owner:  {
            type:  'string',
            pattern:  OP_ADDRESS_PATTERN
        },
        readers:  {
            type:  'array',
            items:  {
                type:  'string',
                pattern:  OP_ADDRESS_PATTERN
            },
        },
        timestamp:  {
            type:  'integer',
            minimum:  1
        },
        files:  {
            type:  'object',
            patternProperties:  {
                OP_URLENCODED_PATTERN: ROOT_DIRECTORY_ENTRY_SCHEMA
            },
        },
        tombstones:  {
            type:  'object',
            patternProperties:  {
                OP_URLENCODED_PATTERN: {
                    type:  'string',
                    pattern:  OP_TOMBSTONE_PATTERN,
                },
            },
        },
    },
    required:  [
        'type',
        'owner',
        'readers',
        'timestamp',
        'proto_version',
        'files',
        'tombstones'
    ],
}

export const FILE_LOOKUP_RESPONSE = {
    type:  'object',
    properties:  {
        status:  {
            type:  'boolean',
        },
        file_info:  ROOT_DIRECTORY_ENTRY_SCHEMA,
    },
    required:  [
        'status',
        'file_info'
    ],
}

export const GET_DEVICE_ROOT_RESPONSE = {
    type:  'object',
    properties:  {
        status:  {
            type:  'boolean',
        },
        device_root_page:  ROOT_DIRECTORY_SCHEMA,
    },
    required:  [
        'status',
        'device_root_page'
    ],
}

export const GET_ROOT_RESPONSE = {
    type:  'object',
    properties:  {
        status:  {
            type:  'boolean',
        },
        root:  {
            type:  'object',
            patternProperties:  {
                OP_URLENCODED_PATTERN: ROOT_DIRECTORY_ENTRY_SCHEMA
            }
        }
    },
    required:  [
        'status',
        'root'
    ],
}


export const PUT_DATASTORE_RESPONSE = {
    type:  'object',
    properties:  {
        status:  {
            type:  'boolean'
        },
        datastore_urls:  {
            type:  'array',
            items:  {
                type:  'string',
                pattern:  OP_URI_TARGET_PATTERN
            },
        },
    },
    required:  [
        'status',
        'datastore_urls',
    ],
}


export const PUT_DATA_RESPONSE = {
    type:  'object',
    properties:  {
        status:  {
            type:  'boolean',
        },
        urls:  {
            anyOf:  [
                {
                    type:  'array',
                    items:  {
                        type:  'string',
                        pattern:  OP_URI_TARGET_PATTERN,
                    },
                },
                {
                    type:  'null',
                },
            ],
        },
    },
    required:  [
        'status', 
        'urls'
    ]
}


export const DATASTORE_SCHEMA = {
    type: 'object',
    properties: {
        type: {
            type: 'string',
            pattern: "([a-zA-Z0-9_]+)$",
        },
        pubkey: {
            type: 'string',
            pattern: OP_PUBKEY_PATTERN,
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
                type:  'string',
            },
        },
        root_uuid: {
            type: 'string',
            pattern: OP_UUID_PATTERN,
        },
    },
    additionalProperties: false,
    required: [
       'type',
       'pubkey',
       'drivers',
       'device_ids',
       'root_uuid',
    ],
};


export const DATASTORE_RESPONSE_SCHEMA = {
   type: 'object',
   properties: {
      datastore: DATASTORE_SCHEMA,
   },
   additionalProperties: false,
   required: ['datastore'],
};


export const CORE_ERROR_SCHEMA = {
   type: 'object',
   properties: {
      error: {
         type: 'string',
      },
      errno: {
         type: 'integer',
      },
   },
   additionalProperties: false,
   required: [
      'errno',
      'error',
   ],
};


export const GET_PROFILE_RESPONSE = {
    type:  'object',
    properties:  {
        status:  {
            type:  'boolean',
        },
        profile:  {
            anyOf:  [
                {
                    type:  'string',
                },
                {
                    type:  'object',
                },
            ],
        },
        zonefile:  {
            type:  'string',
        },
        zonefile_b64:  {
            type:  'string',
            pattern:  OP_BASE64_PATTERN,
        },
        name_record:  {
            type:  'object',
        },
    },
    required:  [
        'status',
        'profile',
        'name_record',
    ],
}

