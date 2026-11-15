const { createSunsuTubeApp } = require('./app.cjs');

const { config, server, store } = createSunsuTubeApp();

server.listen(config.port, config.host, () => {
  console.log(`[순수TV] http://${config.host}:${config.port}  (영상 폴더: ${config.dataDir})`);
});

function closeServer(signal) {
  console.log(`[순수TV] ${signal} 종료 요청`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGINT', () => closeServer('SIGINT'));
process.once('SIGTERM', () => closeServer('SIGTERM'));
