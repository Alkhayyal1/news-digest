import { fs } from '../shims.js';
export const { readdirSync, readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync, copyFileSync, appendFileSync } = fs;
export default fs;
