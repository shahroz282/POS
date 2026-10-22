interface Props {
  moduleNo: number
  title: string
  description: string
  icon: string
}

/** Reusable empty-state placeholder shown for modules not yet implemented. */
export default function PlaceholderPage({ moduleNo, title, description, icon }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[500px] text-center px-8">
      <div className="text-6xl mb-6">{icon}</div>
      <div className="text-xs font-semibold text-brand-500 uppercase tracking-widest mb-2">
        Module {moduleNo}
      </div>
      <h2 className="text-2xl font-bold text-gray-100 mb-3">{title}</h2>
      <p className="text-gray-500 max-w-sm text-sm leading-relaxed">{description}</p>
      <div className="mt-8 inline-flex items-center gap-2 text-xs text-gray-700 bg-gray-900 border border-gray-800 rounded-full px-4 py-2">
        <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
        Not implemented yet
      </div>
    </div>
  )
}
