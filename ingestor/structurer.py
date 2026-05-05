import re

class PolicyStructurer:
    # Regex patterns for common structure elements
    PATTERNS = {
        'heading': r'^[A-Z][^a-z\n]{5,50}$', # ALL CAPS lines, 5-50 chars
        'numbered_section': r'^\d+(\.\d+)*\s+[A-Z].*', # 1.1 Section Title
        'bullet': r'^\s*[\u2022\u00b7\*\-\u25cf]\s+.*' # Bullet points
    }

    @staticmethod
    def detect_structure(text):
        structure = []
        lines = text.split('\n')
        
        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
                
            # Check for numbered sections (e.g., 1. OPERATIONAL BOUNDARIES or 1.1 Section)
            if re.match(r'^\d+(\.\d+)*\.?\s+', line):
                structure.append({
                    'type': 'section',
                    'content': line,
                    'line_number': i + 1
                })
            # Check for potential headings (Short lines, all caps, 3-60 chars)
            elif re.match(r'^[A-Z][A-Z\s0-9]{3,60}$', line):
                structure.append({
                    'type': 'heading',
                    'content': line,
                    'line_number': i + 1
                })
            # Check for bullets
            elif re.match(r'^\s*[\u2022\u00b7\*\-\u25cf]\s+', line):
                structure.append({
                    'type': 'bullet',
                    'content': line,
                    'line_number': i + 1
                })
                
        return structure
