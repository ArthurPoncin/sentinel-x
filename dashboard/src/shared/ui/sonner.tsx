import { Toaster as Sonner, type ToasterProps } from "sonner"

// A colored dot says what kind of toast it is, as everywhere else in the app.
const dot = (className: string) => (
  <span aria-hidden className={className}>
    ●
  </span>
)

const Toaster = ({ ...props }: ToasterProps) => {

  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: dot("text-nominal"),
        info: dot("text-muted-foreground"),
        warning: dot("text-elevated"),
        error: dot("text-critical"),
        loading: dot("animate-pulse text-muted-foreground"),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
