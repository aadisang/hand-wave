type Props = {
  error: string | null;
};

export function IdleStage({ error }: Props) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 pb-20 pt-8">
      <div className="max-w-xs space-y-3 text-center">
        <img
          alt=""
          aria-hidden="true"
          className="mx-auto size-16 rounded-[1.35rem] shadow-[0_18px_44px_rgba(0,0,0,0.35)]"
          src="/favicon.svg"
        />
        <p className="text-balance font-medium">
          {error ?? "No active stream"}
        </p>
        <p className="text-muted-foreground text-pretty text-sm">
          Use the controls below to start camera or screen share
        </p>
      </div>
    </div>
  );
}
