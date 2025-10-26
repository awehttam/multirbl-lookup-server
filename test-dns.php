#!/usr/bin/env php
<?php
/**
 * Test DNS server by sending UDP queries directly
 * This bypasses system DNS resolvers and sends raw DNS packets
 */

// Configuration
$dns_server = '127.0.0.1';
$dns_port = 8053;
$timeout = 5;

// Test queries
$test_queries = [
    
    '2.0.0.127.zen.spamhaus.org',  // Should be listed
    'google.com',                   // Should be forwarded
    '1.1.1.1.zen.spamhaus.org',    // Might not be listed
    '3.0.0.127.multi-rbl.example.com',  // Should be listed
];

echo "DNS Server Tester\n";
echo "=================\n";
echo "Server: {$dns_server}:{$dns_port}\n";
echo "Timeout: {$timeout}s\n\n";

/**
 * Build a DNS query packet
 */
function buildDnsQuery($domain, $query_id = null) {
    if ($query_id === null) {
        $query_id = rand(1, 65535);
    }

    // DNS Header (12 bytes)
    $header = pack('n', $query_id);        // Transaction ID
    $header .= pack('n', 0x0100);          // Flags: standard query, recursion desired
    $header .= pack('n', 1);               // Questions: 1
    $header .= pack('n', 0);               // Answer RRs: 0
    $header .= pack('n', 0);               // Authority RRs: 0
    $header .= pack('n', 0);               // Additional RRs: 0

    // Question section
    $question = '';
    $labels = explode('.', $domain);
    foreach ($labels as $label) {
        $question .= chr(strlen($label)) . $label;
    }
    $question .= chr(0);                   // End of domain name
    $question .= pack('n', 1);             // Type: A (host address)
    $question .= pack('n', 1);             // Class: IN (internet)

    return $header . $question;
}

/**
 * Parse DNS response
 */
function parseDnsResponse($response) {
    if (strlen($response) < 12) {
        return ['error' => 'Response too short'];
    }

    $data = unpack('ntxid/nflags/nqdcount/nancount/nnscount/narcount', $response);

    $result = [
        'transaction_id' => $data['txid'],
        'flags' => $data['flags'],
        'rcode' => $data['flags'] & 0x000F,
        'questions' => $data['qdcount'],
        'answers' => $data['ancount'],
        'authority' => $data['nscount'],
        'additional' => $data['arcount'],
    ];

    // Decode RCODE
    $rcodes = [
        0 => 'NOERROR',
        1 => 'FORMERR',
        2 => 'SERVFAIL',
        3 => 'NXDOMAIN',
        4 => 'NOTIMP',
        5 => 'REFUSED',
    ];
    $result['rcode_name'] = $rcodes[$result['rcode']] ?? "UNKNOWN({$result['rcode']})";

    // Skip question section to get to answers
    $offset = 12;
    for ($i = 0; $i < $data['qdcount']; $i++) {
        // Skip domain name
        while ($offset < strlen($response)) {
            $len = ord($response[$offset]);
            $offset++;
            if ($len == 0) break;
            if ($len >= 0xC0) { // Compression pointer
                $offset++;
                break;
            }
            $offset += $len;
        }
        $offset += 4; // Skip QTYPE and QCLASS
    }

    // Parse answer section
    $result['answer_ips'] = [];
    $result['answer_txt'] = [];
    for ($i = 0; $i < $data['ancount'] && $offset < strlen($response); $i++) {
        // Skip name (can be compressed)
        $len = ord($response[$offset]);
        if ($len >= 0xC0) {
            $offset += 2; // Compression pointer
        } else {
            while ($offset < strlen($response) && ord($response[$offset]) != 0) {
                $len = ord($response[$offset]);
                $offset += $len + 1;
            }
            $offset++; // Skip final 0
        }

        if ($offset + 10 > strlen($response)) break;

        $rr = unpack('ntype/nclass/Nttl/ndlen', substr($response, $offset, 10));
        $offset += 10;

        if ($rr['type'] == 1 && $rr['dlen'] == 4) { // A record
            $ip = ord($response[$offset]) . '.' .
                  ord($response[$offset + 1]) . '.' .
                  ord($response[$offset + 2]) . '.' .
                  ord($response[$offset + 3]);
            $result['answer_ips'][] = $ip;
        } elseif ($rr['type'] == 16) { // TXT record
            // TXT records are length-prefixed strings
            $txt_offset = $offset;
            $txt_data = '';
            while ($txt_offset < $offset + $rr['dlen']) {
                $txt_len = ord($response[$txt_offset]);
                $txt_offset++;
                if ($txt_len > 0 && $txt_offset + $txt_len <= $offset + $rr['dlen']) {
                    $txt_data .= substr($response, $txt_offset, $txt_len);
                    $txt_offset += $txt_len;
                } else {
                    break;
                }
            }
            if (!empty($txt_data)) {
                $result['answer_txt'][] = $txt_data;
            }
        }
        $offset += $rr['dlen'];
    }

    return $result;
}

/**
 * Send DNS query and get response
 */
function queryDns($server, $port, $domain, $timeout) {
    echo "Querying: {$domain}\n";

    // Create socket
    $socket = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
    if ($socket === false) {
        echo "  ERROR: Failed to create socket: " . socket_strerror(socket_last_error()) . "\n\n";
        return;
    }

    // Set timeout
    socket_set_option($socket, SOL_SOCKET, SO_RCVTIMEO, ['sec' => $timeout, 'usec' => 0]);
    socket_set_option($socket, SOL_SOCKET, SO_SNDTIMEO, ['sec' => $timeout, 'usec' => 0]);

    // Build and send query
    $query = buildDnsQuery($domain);
    echo "  Sending " . strlen($query) . " bytes to {$server}:{$port}...\n";

    $sent = socket_sendto($socket, $query, strlen($query), 0, $server, $port);
    if ($sent === false) {
        echo "  ERROR: Failed to send: " . socket_strerror(socket_last_error($socket)) . "\n\n";
        socket_close($socket);
        return;
    }
    echo "  Sent {$sent} bytes\n";

    // Receive response
    echo "  Waiting for response...\n";
    $from = '';
    $port_from = 0;
    $response = '';
    $received = @socket_recvfrom($socket, $response, 512, 0, $from, $port_from);

    if ($received === false) {
        $error = socket_last_error($socket);
        if ($error == 10060 || $error == 110) { // WSAETIMEDOUT or EAGAIN
            echo "  ERROR: Timeout - no response received\n\n";
        } else {
            echo "  ERROR: Failed to receive: " . socket_strerror($error) . "\n\n";
        }
        socket_close($socket);
        return;
    }

    echo "  Received {$received} bytes from {$from}:{$port_from}\n";

    // Parse response
    $result = parseDnsResponse($response);
    echo "  Transaction ID: {$result['transaction_id']}\n";
    echo "  RCODE: {$result['rcode_name']}\n";
    echo "  Answers: {$result['answers']}\n";

    if (!empty($result['answer_ips'])) {
        echo "  IPs: " . implode(', ', $result['answer_ips']) . "\n";
    }

    if (!empty($result['answer_txt'])) {
        echo "  TXT Records:\n";
        foreach ($result['answer_txt'] as $txt) {
            echo "    - {$txt}\n";
        }
    }

    echo "\n";

    socket_close($socket);
}

// Run tests
foreach ($test_queries as $query) {
    queryDns($dns_server, $dns_port, $query, $timeout);
}

echo "Test complete!\n";
