'use strict';
process.env.STORAGE = process.env.STORAGE || 'netlify';
const serverless = require('serverless-http');
const { connectLambda } = require('@netlify/blobs');
const app = require('../../backend/app');
const run = serverless(app, { binary: ['image/*'] });

exports.handler = async (event, context) => {
  try { connectLambda(event); } catch (_) { /* manual BLOBS_SITE_ID/BLOBS_TOKEN mode */ }
  event.path = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  return run(event, context);
};
