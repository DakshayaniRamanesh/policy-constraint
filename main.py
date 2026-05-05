import argparse
import json
import os
from ingestor.pipeline import PolicyIngestionPipeline

def main():
    parser = argparse.ArgumentParser(description="Policy Ingestion Pipeline for Unitree Go2 Edu")
    parser.add_argument("file", help="Path to the policy document (PDF, DOCX, TXT)")
    parser.add_argument("--output", help="Path to save the structured output (JSON)", default="output.json")
    
    args = parser.parse_args()
    
    if not os.path.exists(args.file):
        print(f"Error: File {args.file} does not exist.")
        return

    pipeline = PolicyIngestionPipeline()
    result = pipeline.process(args.file)
    
    # Save output
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4)
        
    print(f"\nProcessing complete. Status: {result['status']}")
    print(f"Output saved to: {args.output}")

if __name__ == "__main__":
    main()
