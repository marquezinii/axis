type Props = {
  selected: string;
  onSelect: (provider: string) => void;
};

const providers = [
  { id: 'claude', label: 'Claude' },
  { id: 'opencode', label: 'OpenCode' },
];

export function ProviderSelector({ selected, onSelect }: Props) {
  return (
    <div className="provider-selector">
      {providers.map((p) => (
        <button
          key={p.id}
          className={`provider-tab ${selected === p.id ? 'active' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}