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
  'be-button',
  {
    variants: {
      variant: {
        default: 'be-button--primary',
        destructive: 'be-button--destructive',
        outline: 'be-button--outline',
        secondary: 'be-button--secondary',
        ghost: 'be-button--ghost',
        link: 'be-button--link',
      },
      size: {
        default: 'be-button--md',
        sm: 'be-button--sm',
        lg: 'be-button--lg',
        icon: 'be-button--icon',
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
