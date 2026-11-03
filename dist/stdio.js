#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './tools.js';
import { fetchTextNode } from './fetch-node.js';
const server = createServer(fetchTextNode);
await server.connect(new StdioServerTransport());
