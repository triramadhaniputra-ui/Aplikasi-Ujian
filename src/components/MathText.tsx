import React from 'react';
import katex from 'katex';

interface MathTextProps {
  text: string;
  className?: string;
}

export const MathText: React.FC<MathTextProps> = ({ text, className = '' }) => {
  if (!text) return null;

  // Split by $$...$$ or $...$
  const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);

  return (
    <span className={className}>
      {parts.map((part, idx) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const tex = part.slice(2, -2);
          try {
            const html = katex.renderToString(tex, { displayMode: true, throwOnError: false });
            return <span key={idx} className="block my-2" dangerouslySetInnerHTML={{ __html: html }} />;
          } catch {
            return <span key={idx}>{part}</span>;
          }
        }
        if (part.startsWith('$') && part.endsWith('$')) {
          const tex = part.slice(1, -1);
          try {
            const html = katex.renderToString(tex, { displayMode: false, throwOnError: false });
            return <span key={idx} className="inline-block align-middle mx-0.5" dangerouslySetInnerHTML={{ __html: html }} />;
          } catch {
            return <span key={idx}>{part}</span>;
          }
        }
        // Simple **bold** inline formatting
        const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
        return (
          <React.Fragment key={idx}>
            {boldParts.map((bp, bIdx) =>
              bp.startsWith('**') && bp.endsWith('**') ? (
                <strong key={bIdx} className="font-semibold text-slate-900">
                  {bp.slice(2, -2)}
                </strong>
              ) : (
                <React.Fragment key={bIdx}>{bp}</React.Fragment>
              )
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
};
