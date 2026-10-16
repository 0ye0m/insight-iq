import re


# Question type classification patterns
QUESTION_PATTERNS = {
    'METADATA': [
        r'\b(what|which|how many)\s+(columns?|fields?|variables?|features?|rows?|records?|entries?)\s*(are|is|do|does)?\b',
        r'\b(schema|structure|columns? list|data dict)\b',
        r'\bdescribe\s+(the\s+)?(dataset|data|file)\b',
        r'\bwhat\s+(is|are)\s+this\s+(dataset|data|file|about)\b',
    ],
    'STATISTICS': [
        r'\b(average|mean|median|mode|standard\s*deviation|std|variance)\b',
        r'\b(minimum|maximum|min|max|range)\b',
        r'\b(statistics|stats|descriptive)\b',
        r'\b(what\s+is\s+the)\s+(average|mean|median|std)\b',
    ],
    'AGGREGATION': [
        r'\b(highest|lowest|most|least|top|bottom|best|worst)\b',
        r'\b(total|sum|count|aggregate)\b',
        r'\bwhich\s+.*(has|have|had)\s+the\s+(most|least|highest|lowest|greatest)\b',
        r'\b(how\s+many|how\s+much)\b',
    ],
    'FILTERING': [
        r'\b(where|when|filter|only|those|which\s+.*\s+are)\b',
        r'\b(greater|less|more|higher|lower|above|below|between)\s+than\b',
        r'\b(show|find|list|display|get)\s+.*\s+(where|with|having)\b',
    ],
    'CORRELATION': [
        r'\b(correlat|relationship|associated|related|linked)\b',
        r'\b(how\s+does)\s+.*\s+(affect|impact|influence|relate)\b',
        r'\b(between)\s+.*\s+(and)\s+.*\b',
    ],
    'TREND': [
        r'\b(trend|growth|decline|increase|decrease|over\s+time|pattern)\b',
        r'\b(how\s+has)\s+.*\s+(changed|grown|evolved)\b',
    ],
    'CLEANING': [
        r'\b(missing|null|nan|empty|duplicate|clean|outlier)\b',
        r'\b(data\s+quality|quality\s+check)\b',
    ],
    'DOCUMENT_LOOKUP': [
        r'\b(what\s+does)\s+(the|this|that)\s+(document|report|paper|article|file)\b',
        r'\b(according\s+to|mentioned\s+in|stated\s+in|found\s+in)\b',
        r'\b(page|section|chapter|slide)\s+\d+\b',
    ],
    'DOCUMENT_SUMMARY': [
        r'\b(summar|overview|main\s+point|key\s+finding|conclusion|takeaway)\b',
        r'\b(what\s+are)\s+(the\s+)?(main|key|important)\s+(finding|point|theme|topic)\b',
    ],
}


def route_question(question, file_type, analysis=None):
    """
    Classify a user question into a question type.
    Returns one of the defined question types.
    """
    if not question:
        return 'GENERAL_ANALYTICS'

    q_lower = question.lower().strip()
    scores = {}

    for q_type, patterns in QUESTION_PATTERNS.items():
        score = 0
        for pattern in patterns:
            if re.search(pattern, q_lower, re.IGNORECASE):
                score += 1
        scores[q_type] = score

    # Get the type with highest score
    max_score = max(scores.values())
    if max_score == 0:
        return 'GENERAL_ANALYTICS'

    # Get all types with max score
    top_types = [t for t, s in scores.items() if s == max_score]

    if len(top_types) == 1:
        return top_types[0]

    # If multiple types match equally, check for MIXED
    if file_type == 'DOCUMENT':
        doc_types = {'DOCUMENT_LOOKUP', 'DOCUMENT_SUMMARY'}
        if any(t in doc_types for t in top_types) and any(t not in doc_types for t in top_types):
            return 'MIXED'
        # Default to document lookup for document files
        for t in top_types:
            if t in doc_types:
                return t

    if file_type == 'TABULAR':
        tab_types = {'STATISTICS', 'AGGREGATION', 'FILTERING', 'CORRELATION', 'TREND', 'METADATA', 'CLEANING'}
        tab_matches = [t for t in top_types if t in tab_types]
        if tab_matches:
            return tab_matches[0]

    return top_types[0]