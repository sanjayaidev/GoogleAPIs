// Central registry of all provider modules. To add Calendar, Sheets, Meta,
// etc: create src/modules/<name>.js following the same contract as
// gmail.js, then add one line here. No other file needs to change.
const gmail = require('./gmail');

const modules = {
  gmail,
  // calendar: require('./calendar'),
  // sheets: require('./sheets'),
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
