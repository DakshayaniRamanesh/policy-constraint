import re

class PolicyCleaner:
    @staticmethod
    def normalize_whitespace(text):
        # Replace multiple spaces with single space
        text = re.sub(r'[ \t]+', ' ', text)
        # Replace 3 or more newlines with 2 newlines (preserve paragraph separation)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    @staticmethod
    def remove_duplicate_lines(text):
        lines = text.split('\n')
        seen = set()
        unique_lines = []
        for line in lines:
            trimmed = line.strip()
            if trimmed == "":
                unique_lines.append(line)
                continue
            if trimmed not in seen:
                unique_lines.append(line)
                seen.add(trimmed)
        return '\n'.join(unique_lines)

    @staticmethod
    def strip_repeated_headers_footers(pages):
        if not pages or len(pages) < 2:
            return pages
            
        # Check first and last lines for repeats across majority of pages
        header_candidates = {}
        footer_candidates = {}
        page_count = len(pages)
        
        for page in pages:
            lines = [l.strip() for l in page.split('\n') if l.strip()]
            if not lines: continue
            
            first = lines[0]
            last = lines[-1]
            
            header_candidates[first] = header_candidates.get(first, 0) + 1
            footer_candidates[last] = footer_candidates.get(last, 0) + 1
            
        # If a line appears in more than 50% of pages as first/last line, it's likely a header/footer
        headers_to_remove = {h for h, count in header_candidates.items() if count > page_count * 0.5}
        footers_to_remove = {f for f, count in footer_candidates.items() if count > page_count * 0.5}
        
        cleaned_pages = []
        for page in pages:
            lines = page.split('\n')
            new_lines = []
            for l in lines:
                stripped = l.strip()
                if stripped in headers_to_remove or stripped in footers_to_remove:
                    continue
                new_lines.append(l)
            cleaned_pages.append('\n'.join(new_lines))
            
        return cleaned_pages

    @classmethod
    def clean(cls, pages):
        if isinstance(pages, str):
            pages = [pages]
            
        pages = cls.strip_repeated_headers_footers(pages)
        
        full_text = '\n'.join(pages)
        full_text = cls.remove_duplicate_lines(full_text)
        full_text = cls.normalize_whitespace(full_text)
        return full_text
