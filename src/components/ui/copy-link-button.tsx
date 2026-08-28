import { createSignal, JSX, splitProps, ValidComponent } from 'solid-js';
import { Button, ButtonProps } from './button';
import { PolymorphicProps } from '@kobalte/core/polymorphic';

type CopyLinkButtonProps<T extends ValidComponent = 'button'> = PolymorphicProps<
  T,
  ButtonProps<T>
> & {
  text?: string;
  copiedLabel?: string;
  children?: JSX.Element;
};

export default function CopyLinkButton<T extends ValidComponent = 'button'>(
  props: CopyLinkButtonProps<T>,
) {
  const [local, others] = splitProps(props as CopyLinkButtonProps, [
    'text',
    'copiedLabel',
    'children',
  ]);
  const [copied, setCopied] = createSignal(false);

  return (
    <Button
      {...others}
      onClick={() => {
        navigator.clipboard.writeText(local.text ?? window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}>
      {copied() ? (local.copiedLabel ?? 'Copied!') : (local.children ?? 'Copy Invite Link')}
    </Button>
  );
}
