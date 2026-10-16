import xml.etree.ElementTree as ET
import json


def parse_xml(file_path, cfg):
    """
    Parse XML files: convert to structured data.
    For deeply nested XML, preserve hierarchy with depth limits.
    Returns a normalized document dict.
    """
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        raw = f.read()

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise ValueError(f'Invalid XML: {e}')

    # Convert to structured data
    structured = _xml_to_dict(root, max_depth=5)

    # Extract all text content
    all_text = []
    for elem in root.iter():
        if elem.text and elem.text.strip():
            all_text.append(elem.text.strip())
        if elem.tail and elem.tail.strip():
            all_text.append(elem.tail.strip())

    # Try to find tabular structure
    tables = _find_xml_tables(root)

    full_text = '\n'.join(all_text)

    result = {
        'metadata': {'rootTag': root.tag, 'childCount': len(root)},
        'pages': [],
        'sections': [{
            'heading': f'XML Document ({root.tag})',
            'content': full_text[:cfg['max_extracted_text_chars']],
        }],
        'tables': tables,
        'totalPages': 1,
        'documentType': 'XML',
        'fullText': full_text[:cfg['max_extracted_text_chars']],
        'structuredData': structured,
    }

    return result


def _xml_to_dict(element, max_depth=5, current_depth=0):
    """Recursively convert XML element to dict with depth limit."""
    result = {'_tag': element.tag}

    # Attributes
    if element.attrib:
        result['_attributes'] = dict(element.attrib)

    # Children
    children = {}
    text_content = element.text.strip() if element.text else ''

    if current_depth >= max_depth:
        if text_content:
            result['_text'] = text_content
        return result

    child_count = {}
    for child in element:
        child_data = _xml_to_dict(child, max_depth, current_depth + 1)
        tag = child.tag
        if tag in child_count:
            child_count[tag] += 1
        else:
            child_count[tag] = 1

        if tag in children:
            if not isinstance(children[tag], list):
                children[tag] = [children[tag]]
            children[tag].append(child_data)
        else:
            children[tag] = child_data

    if children:
        result.update(children)
    elif text_content:
        result['_text'] = text_content

    return result


def _find_xml_tables(root):
    """Find repeated sibling structures that could represent tables."""
    tables = []
    # Look for elements that have many siblings with similar structure
    for parent in root.iter():
        children = list(parent)
        if len(children) < 2:
            continue

        # Check if all children have similar sub-elements
        child_keys = set()
        for child in children:
            keys = set(c.tag for c in child)
            child_keys.update(keys)

        if len(child_keys) > 1 and len(child_keys) <= 20:
            # Potential tabular structure
            headers = sorted(child_keys)
            rows = []
            for child in children:
                row = {}
                for key in headers:
                    elem = child.find(key)
                    if elem is not None:
                        row[key] = (elem.text or '').strip()
                    else:
                        row[key] = ''
                rows.append(list(row.values()))

            if len(rows) > 1:
                tables.append({
                    'headers': headers,
                    'rows': rows,
                    'rowCount': len(rows),
                    'colCount': len(headers),
                })

    return tables[:10]  # Limit tables
