import { splitProps, type ValidComponent } from 'solid-js';
import { Button as ButtonPrimitive, type ButtonRootProps } from '@kobalte/core/button';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * solid-ui Button — Kobalte's accessible button primitive + cva variants,
 * styled against the project's dark token bridge (see `@theme` in global.css).
 * `secondary` is the default for neutral chrome; `default` is the primary accent CTA.
 */
export const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[12px] font-semibold uppercase tracking-[0.06em] transition-[background,border-color,color,box-shadow,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40',
	{
		variants: {
			variant: {
				default:
					'border border-primary/60 bg-[image:var(--gradient-primary)] text-primary-foreground shadow-[var(--shadow-primary)] hover:brightness-110',
				destructive:
					'border border-destructive/55 bg-destructive text-destructive-foreground hover:brightness-110',
				outline:
					'border border-input bg-card/70 text-foreground hover:border-ring hover:bg-primary/10',
				secondary:
					'border border-border bg-secondary/85 text-secondary-foreground hover:border-ring hover:text-foreground',
				ghost: 'text-muted-foreground hover:bg-primary/10 hover:text-foreground',
				link: 'text-primary underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-8 px-3 py-1.5',
				sm: 'h-7 rounded-sm px-2',
				lg: 'h-10 px-6',
				icon: 'size-8'
			}
		},
		defaultVariants: {
			variant: 'secondary',
			size: 'default'
		}
	}
);

type ButtonProps<T extends ValidComponent = 'button'> = ButtonRootProps<T> &
	VariantProps<typeof buttonVariants> & { class?: string };

export function Button<T extends ValidComponent = 'button'>(
	props: PolymorphicProps<T, ButtonProps<T>>
) {
	const [local, rest] = splitProps(props as ButtonProps<T>, ['class', 'variant', 'size']);
	const primitiveProps = {
		class: cn(buttonVariants({ variant: local.variant, size: local.size }), local.class),
		...rest
	} as unknown as PolymorphicProps<T, ButtonRootProps<T>>;

	return (
		<ButtonPrimitive {...primitiveProps} />
	);
}
