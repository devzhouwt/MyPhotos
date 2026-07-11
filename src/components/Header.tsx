import { Link, useNavigate } from 'react-router-dom'
import { IconImage, IconSettings } from '@/components/icons'

export default function Header() {
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between px-6 h-14 bg-white border-b border-[var(--color-border)] shrink-0 sticky top-0 z-30">
      <Link to="/" className="flex items-center gap-2.5 no-underline group">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4f6ef7] to-[#6c5ce7] flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
          <IconImage size={14} className="text-white" />
        </div>
        <span className="text-[18px] font-semibold text-[var(--color-primary)] tracking-tight">云相册</span>
      </Link>

      <button
        onClick={() => navigate('/settings')}
        className="btn btn-ghost btn-icon hover:bg-slate-100"
        title="设置"
      >
        <IconSettings size={18} />
      </button>
    </header>
  )
}
