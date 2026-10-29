export function PageLoading({ message }: { message: string }) {
  return (
    <main className="grid h-full place-items-center text-sm text-muted-foreground" role="status">
      {message}
    </main>
  );
}
