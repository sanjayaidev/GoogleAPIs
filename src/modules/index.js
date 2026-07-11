// Central registry of all provider modules. To add a new one: create
// src/modules/<name>.js following the same contract as gmail.js, then add
// one line here. No other file needs to change.
const gmail = require('./gmail');
const calendar = require('./calendar');
const sheets = require('./sheets');
const docs = require('./docs');
const drive = require('./drive');
const forms = require('./forms');
const googleBusinessProfile = require('./googleBusinessProfile');

const modules = {
  gmail,
  calendar,
  sheets,
  docs,
  drive,
  forms,
  googleBusinessProfile,
  // meta: require('./meta'),
};

function getModule(name) {
  return modules[name];
}

function listModules() {
  return Object.entries(modules).map(([name, mod]) => ({
    name,
    provider: mod.provider,
    actions: Object.keys(mod.actions || {}),
    triggers: Object.keys(mod.triggers || {}),
  }));
}

module.exports = { modules, getModule, listModules };
