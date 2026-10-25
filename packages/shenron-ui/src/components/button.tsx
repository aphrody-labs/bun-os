"use client";

/**
 * Trousse `components/ui/` — périmètre volontairement restreint.
 *
 * Ces primitives (base-ui + cva + tokens shadcn : `bg-primary`, `ring`,
 * `destructive`…) ne servent QU'À l'éditeur d'articles de l'admin
 * (`app/admin/posts/`). Elles ne sont pas le système de design du site.
 *
 * Le langage visuel de dragonballfr.com vit dans `globals.css` : `.dbz-button`,
 * `.dbz-panel`, `.btn`, `.input`, adossés aux tokens `--color-dbz-*` que
 * `/admin/design` pilote au runtime. Les 460 `<button>` du site l'utilisent —
 * c'est cohérent, thémable, et il n'y a rien à « migrer ».
 *
 * Autrement dit : ne pas généraliser `<Button>`, et ne pas supprimer ces
 * fichiers non plus (l'éditeur d'articles en dépend). L'état intermédiaire est
 * ici un choix, pas un oubli.
 */
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border-2 border-black/80 bg-clip-padding text-sm font-bold tracking-wide uppercase whitespace-nowrap transition-all outline-none select-none hover:border-dbz-yellow active:translate-x-[1.5px] active:translate-y-[1.5px] focus-visible:border-ring focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-black hover:bg-primary/90",
        outline:
          "border-current bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground border-black/60 hover:bg-secondary/90 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "border-transparent hover:border-transparent hover:bg-muted hover:text-foreground active:translate-x-0 active:translate-y-0 aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "border-destructive bg-destructive/15 text-destructive hover:bg-destructive/25 focus-visible:border-destructive/40 focus-visible:outline-destructive/20 dark:bg-destructive/25 dark:hover:bg-destructive/35 dark:focus-visible:outline-destructive/40",
        link: "border-transparent hover:border-transparent active:translate-x-0 active:translate-y-0 text-primary underline-offset-4 hover:underline",
        dragonball:
          "border-2 border-black bg-gradient-to-r from-dbz-orange to-amber-500 text-black font-extrabold hover:brightness-110",
        saiyan:
          "border-2 border-black bg-gradient-to-r from-amber-400 via-dbz-yellow to-amber-300 text-black font-black hover:brightness-110",
        scouter: "border-2 border-green-500/90 bg-[#061408] text-green-300 font-mono hover:bg-[#0a200e]",
        capsule:
          "border-2 border-dbz-blue-light bg-[#08142a] text-dbz-blue-light font-extrabold hover:bg-[#0d1e3d] rounded-full",
      },
      size: {
        default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: Omit<ButtonPrimitive.Props, "key"> & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
