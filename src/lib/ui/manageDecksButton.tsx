import { Component } from 'solid-js';

export const ManageDecksButton: Component<{ onClick: () => void }> = props => (
  <button
    type='button'
    onClick={props.onClick}
    class='border border-white/30 text-white px-6 py-3 rounded-xl hover:bg-white/10 transition'>
    Manage Decks
  </button>
);
