export function Header() {
  return (
    <header className="flex flex-col gap-1 text-center">
      <h1 className="font-bold text-3xl sm:text-4xl">Hand Wave</h1>
      <p className="text-muted-foreground text-sm">
        Share your screen or camera to detect sign language in real-time
      </p>
    </header>
  );
}
