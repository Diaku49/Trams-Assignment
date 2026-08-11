// Process entrypoint: load env, start HTTP listener.

import 'dotenv/config';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`api-gateway listening on http://localhost:${port}`);
});
