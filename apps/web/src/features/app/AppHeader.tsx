export function AppHeader({
  profileName,
  avatarUrl,
  onSignOut,
  onNewConversation,
}: {
  profileName: string;
  avatarUrl?: string;
  onSignOut: () => void;
  onNewConversation: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-bg-surface-1/60 backdrop-blur-sm shrink-0">
      {/* Left: Wordmark */}
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold tracking-tight">
          <span className="text-accent-teal">Prosody</span>
        </h1>
        <span className="text-text-muted text-[10px] font-medium uppercase tracking-widest hidden sm:inline">
          Coach
        </span>
      </div>

      {/* Right: Actions + user */}
      <div className="flex items-center gap-3">
        <button className="btn-primary text-xs px-3 py-1.5" onClick={onNewConversation}>
          + New
        </button>
        <div className="flex items-center gap-2">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="w-7 h-7 rounded-full object-cover border border-border-subtle"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-bg-surface-3 border border-border-subtle flex items-center justify-center text-xs font-semibold text-text-secondary">
              {profileName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-xs text-text-secondary hidden md:inline max-w-[120px] truncate">
            {profileName}
          </span>
        </div>
        <button
          className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          onClick={onSignOut}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
