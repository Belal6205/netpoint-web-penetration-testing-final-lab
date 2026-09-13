// NetPoint inventory-sync agent.
// Runs inside the private Docker network only; warehouse tooling polls it
// for stock levels and deployment credentials. Never exposed to the internet.
const http = require('http');

const PORT = 4000;

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/healthz') {
    return send(res, 200, 'text/plain', 'ok');
  }

  if (url === '/metrics') {
    return send(res, 200, 'text/plain', [
      '# HELP netpoint_stock_units Products below reorder threshold',
      '# TYPE netpoint_stock_units gauge',
      'netpoint_stock_units{sku="NP-AC1200"} 42',
      'netpoint_stock_units{sku="NP-MESH6"} 18',
      'netpoint_stock_units{sku="NP-CAM2K"} 33',
      '',
      '# Deployment note (internal):',
      'aws_access_key_id=AKIAIOSFODNN7EXAMPLE',
      'aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    ].join('\n'));
  }

  if (url === '/debug/env') {
    return send(res, 200, 'application/json', JSON.stringify({
      service: 'inventory-sync',
      INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN || 'npt_internal_9f2c1',
      ERP_ENDPOINT: 'http://erp-legacy.netpoint.internal:8080/api',
      DEPLOY_KEY: 'deploy-npt-4f8a2b1c9d',
      DB_DSN: 'mysql://netpoint:npt_store_2024@db:3306/netpoint',
    }, null, 2));
  }

  if (url === '/') {
    return send(res, 200, 'text/plain', 'inventory-sync internal agent\n');
  }

  send(res, 404, 'text/plain', 'not found');
});

server.listen(PORT, () => console.log(`inventory-sync listening on :${PORT} (internal only)`));
