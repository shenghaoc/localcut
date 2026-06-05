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
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-card hover:border-ring',
        secondary: 'border border-border bg-secondary text-secondary-foreground hover:border-ring',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 py-1.5',
        sm: 'h-7 rounded-sm px-2',
        lg: 'h-10 px-6',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
);

type ButtonProps<T extends ValidComponent = 'button'> = ButtonRootProps<T> &
  VariantProps<typeof buttonVariants> & { class?: string };

export function Button<T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, ButtonProps<T>>,
) {
  const [local, rest] = splitProps(props as ButtonProps, ['class', 'variant', 'size']);
  return (
    <ButtonPrimitive
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      {...rest}
    />
  );
}
