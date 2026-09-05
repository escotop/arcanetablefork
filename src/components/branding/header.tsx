import GithubIcon from '~/lib/icons/github.svg';
import PatreonIcon from '~/lib/icons/patreon.svg';
import DiscordIcon from '~/lib/icons/discord-brands-solid.svg';
import { A } from '@solidjs/router';

export default function BrandingHeader() {
  return (
    <div class='relative flex items-center justify-between py-6'>
      <A href='/'>
      <div class='flex items-center space-x-4'>
        <img src='/icon.svg' alt='Untapped Table' class='w-12 h-12' />
        <span class='text-xl font-bold text-white'>Untapped Table</span>
        </div>
      </A>
      <nav class='space-x-4 flex'>
        <a href='https://discord.gg/wzdj2W9vvf' target='_blank' aria-label='Discord'>
          <DiscordIcon style='fill: currentColor;' class='h-8 w-8' />
        </a>
        <a href='https://github.com/odama626/arcanetable/' target='_blank' aria-label='GitHub'>
          <GithubIcon style='fill: currentColor;' class='h-8 w-8' />
        </a>
        <a href='https://patreon.com/arcanetable' target='_blank' aria-label='Patreon'>
          <PatreonIcon style='fill: currentColor' class='h-8 w-8' />
        </a>
      </nav>
    </div>
  );
}
