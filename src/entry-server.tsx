import { createHandler, StartServer } from '@solidjs/start/server';

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang='en'>
        <head>
          <meta charset='utf-8' />
          <meta name='viewport' content='width=device-width, initial-scale=1' />
          <link rel='manifest' href='/site.webmanifest' />
          <link rel='icon' type='image/svg+xml' href='/favicon.svg' />
          <link rel='icon' type='image/png' href='/favicon.png' />
          <meta name='msapplication-TileColor' content='#da532c' />
          <meta name='theme-color' content='#ffffff' />
          {assets}
        </head>
        <body>
          <div id='app'>{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
