import magic
import os

class PolicyValidator:
    ALLOWED_MIMES = {
        'application/pdf': 'PDF',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
        'text/plain': 'TXT'
    }

    @staticmethod
    def validate(file_path):
        """
        Verifies the MIME type of the file.
        Returns (is_valid, mime_type, extension_type)
        """
        if not os.path.exists(file_path):
            return False, None, "File not found"

        mime = magic.Magic(mime=True)
        detected_mime = mime.from_file(file_path)

        if detected_mime in PolicyValidator.ALLOWED_MIMES:
            return True, detected_mime, PolicyValidator.ALLOWED_MIMES[detected_mime]
        
        return False, detected_mime, None
