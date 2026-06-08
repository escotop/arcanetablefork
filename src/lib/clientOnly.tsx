import { isHydrated } from '@solid-primitives/lifecycle';
import { ParentProps, Show } from 'solid-js';

export default function ClientOnly(props: ParentProps) {
	return <Show when={isHydrated()}>{props.children}</Show>;
}
