import { splitProps, type JSX } from 'solid-js';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

interface ButtonVariantOptions {
	variant?: ButtonVariant | null;
	size?: ButtonSize | null;
}

export function buttonVariants(options: ButtonVariantOptions = {}): string {
	return cn(
		'button',
		`button-variant-${options.variant ?? 'secondary'}`,
		`button-size-${options.size ?? 'default'}`
	);
}

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> &
	ButtonVariantOptions & {
		class?: string;
	};

export function Button(props: ButtonProps): JSX.Element {
	const [local, rest] = splitProps(props, ['class', 'variant', 'size', 'type']);

	return (
		<button
			{...rest}
			type={local.type ?? 'button'}
			class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
		/>
	);
}
