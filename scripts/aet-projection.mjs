import fs from 'node:fs';import {projectAet} from '../server/model.mjs';
const state=JSON.parse(fs.readFileSync(new URL('../data/state.json',import.meta.url)));console.log(JSON.stringify({rows:projectAet(state),contracts:state.contracts.filter(c=>c.society==='AET')}));
