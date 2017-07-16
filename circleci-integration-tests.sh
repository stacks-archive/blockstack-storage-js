#!/bin/sh

BLOCKSTACK_BRANCH="rc-0.14.3"
BLOCKSTACK_JS_BRANCH="master"

# get bitcoind
sudo add-apt-repository -y ppa:bitcoin/bitcoin || exit 1
sudo apt-key adv --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys F76221572C52609D
sudo apt-get -y update || exit 1
sudo apt-get -y install bitcoind || exit 1

# needed on CircleCI's VMs
pip install --upgrade pip
pip install --upgrade six
pip install --upgrade setuptools
pip install --upgrade cryptography
pip install --upgrade scrypt
pip install --upgrade fastecdsa

# fetch and install virtualchain
git clone https://github.com/blockstack/virtualchain /tmp/virtualchain
cd /tmp/virtualchain && git checkout "$BLOCKSTACK_BRANCH"
cd /tmp/virtualchain && ./setup.py build && ./setup.py install

# fetch blockstack core and integration tests
git clone https://github.com/blockstack/blockstack-core /tmp/blockstack-core
cd /tmp/blockstack-core && git checkout "$BLOCKSTACK_BRANCH"

# install blockstack core and integration tests
cd /tmp/blockstack-core && ./setup.py build && ./setup.py install
cd /tmp/blockstack-core/integration_tests && ./setup.py build && ./setup.py install

# install npm 5
npm install -g npm@^5.3.0

# set up node
npm install -g browserify
npm uninstall -g babel
npm install -g --save-dev babel-cli
npm install -g --save-dev babel-preset-es2015

# get blockstack.js
git clone https://github.com/blockstack/blockstack.js /tmp/blockstack.js
cd /tmp/blockstack.js && git checkout "$BLOCKSTACK_JS_BRANCH" && npm install && npm link

# set up blockstack-storage.js
cd "$HOME"/blockstack-storage-js && rm -rf node_modules && npm install && npm link blockstack && npm link

# keep the integration framework happy
sudo mkdir -p /usr/lib/node_modules
sudo ln -s "$(npm config get prefix)"/lib/node_modules/blockstack /usr/lib/node_modules/blockstack
sudo ln -s "$(npm config get prefix)"/lib/node_modules/blockstack-storage /usr/lib/node_modules/blockstack-storage

# run the relevant integration tests
blockstack-test-scenario blockstack_integration_tests.scenarios.name_preorder_register_portal_auth || exit 1
blockstack-test-scenario blockstack_integration_tests.scenarios.name_preorder_register_portal_datastore || exit 1
