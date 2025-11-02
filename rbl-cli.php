#!/usr/bin/env php
<?php
/**
 * RBL Lookup CLI Tool
 *
 * Command-line tool to query the RBL API service and display results
 * in a nicely formatted text table.
 *
 * Usage:
 *   php rbl-cli.php <ip-address> [options]       # Regular RBL lookup
 *   php rbl-cli.php custom <command> [args]      # Custom RBL management
 *
 * Options:
 *   --host=<host>     API server host (default: localhost)
 *   --port=<port>     API server port (default: 3000)
 *   --filter=<type>   Filter results: all, listed, clean, error (default: all)
 *   --no-color        Disable colored output
 *   --json            Output raw JSON instead of table
 *   --help            Show this help message
 *
 * Custom RBL Commands:
 *   custom add <cidr> [reason]           # Add IP/CIDR to blocklist
 *   custom remove <cidr>                 # Remove IP/CIDR from blocklist
 *   custom list [--limit=N]              # List all entries
 *   custom config [--zone=<name>]        # View/update config
 *   custom apikey generate [--desc=...]  # Generate API key
 *
 * Configuration File:
 *   Settings can be stored in ~/.rbl-cli.rc (INI format)
 *   Command-line options override config file settings
 *   Add 'api-key = YOUR_KEY' for custom RBL management
 */

class RBLCli {
    private $apiHost = 'localhost';
    private $apiPort = 3000;
    private $useColor = true;
    private $filter = 'all';
    private $jsonOutput = false;
    private $useTls = false;
    private $verifySsl = true;
    private $apiKey = null;

    // ANSI color codes
    private $colors = [
        'reset' => "\033[0m",
        'red' => "\033[31m",
        'green' => "\033[32m",
        'yellow' => "\033[33m",
        'blue' => "\033[34m",
        'magenta' => "\033[35m",
        'cyan' => "\033[36m",
        'white' => "\033[37m",
        'bold' => "\033[1m",
        'dim' => "\033[2m",
    ];

    public function __construct($args) {
        $this->loadConfigFile();
        $this->parseArgs($args);
    }

    private function loadConfigFile() {
        // Get home directory (works on both Unix and Windows)
        $home = getenv('HOME');
        if (!$home) {
            $home = getenv('USERPROFILE'); // Windows
        }

        if (!$home) {
            return; // No home directory found, skip config file
        }

        $configFile = $home . DIRECTORY_SEPARATOR . '.rbl-cli.rc';

        if (!file_exists($configFile)) {
            return; // Config file doesn't exist, skip
        }

        // Parse INI file
        $config = @parse_ini_file($configFile);

        if ($config === false) {
            // Config file is malformed, issue warning but continue
            fwrite(STDERR, "Warning: Could not parse config file: $configFile\n");
            return;
        }

        // Apply config file settings (using same names as CLI options)
        if (isset($config['host'])) {
            $this->apiHost = $config['host'];
        }

        if (isset($config['port'])) {
            $this->apiPort = intval($config['port']);
        }

        if (isset($config['filter'])) {
            $this->filter = $config['filter'];
        }

        if (isset($config['no-color'])) {
            $this->useColor = !$config['no-color'];
        }

        if (isset($config['json'])) {
            $this->jsonOutput = (bool)$config['json'];
        }

        if (isset($config['tls'])) {
            $this->useTls = (bool)$config['tls'];
        }

        if (isset($config['verify-ssl'])) {
            $this->verifySsl = (bool)$config['verify-ssl'];
        }

        if (isset($config['api-key'])) {
            $this->apiKey = $config['api-key'];
        }
    }

    private function parseArgs($args) {
        foreach ($args as $arg) {
            if (strpos($arg, '--host=') === 0) {
                $this->apiHost = substr($arg, 7);
            } elseif (strpos($arg, '--port=') === 0) {
                $this->apiPort = intval(substr($arg, 7));
            } elseif (strpos($arg, '--filter=') === 0) {
                $this->filter = substr($arg, 9);
            } elseif ($arg === '--no-color') {
                $this->useColor = false;
            } elseif ($arg === '--json') {
                $this->jsonOutput = true;
            } elseif ($arg === '--tls') {
                $this->useTls = true;
            } elseif ($arg === '--no-verify-ssl') {
                $this->verifySsl = false;
            } elseif ($arg === '--help' || $arg === '-h') {
                $this->showHelp();
                exit(0);
            }
        }
    }

    private function color($text, $color) {
        if (!$this->useColor) {
            return $text;
        }
        return $this->colors[$color] . $text . $this->colors['reset'];
    }

    private function showHelp() {
        echo $this->color("RBL Lookup CLI Tool\n", 'bold');
        echo "\n";
        echo "Usage: php rbl-cli.php <ip-address> [options]\n";
        echo "\n";
        echo "Options:\n";
        echo "  --host=<host>     API server host (default: localhost)\n";
        echo "  --port=<port>     API server port (default: 3000)\n";
        echo "  --filter=<type>   Filter results: all, listed, clean, error (default: all)\n";
        echo "  --tls             Use HTTPS instead of HTTP\n";
        echo "  --no-verify-ssl   Disable SSL certificate verification (use with caution)\n";
        echo "  --no-color        Disable colored output\n";
        echo "  --json            Output raw JSON instead of table\n";
        echo "  --help, -h        Show this help message\n";
        echo "\n";
        echo "Configuration File:\n";
        echo "  Settings can be stored in ~/.rbl-cli.rc (INI format)\n";
        echo "  Command-line options override config file settings\n";
        echo "\n";
        echo "  Example config file:\n";
        echo "    host = example.com\n";
        echo "    port = 8080\n";
        echo "    filter = listed\n";
        echo "    tls = true\n";
        echo "    verify-ssl = true\n";
        echo "    no-color = false\n";
        echo "    json = false\n";
        echo "\n";
        echo "Examples:\n";
        echo "  php rbl-cli.php 8.8.8.8\n";
        echo "  php rbl-cli.php 8.8.8.8 --filter=listed\n";
        echo "  php rbl-cli.php 127.0.0.2 --host=example.com --port=8080\n";
        echo "  php rbl-cli.php 8.8.8.8 --json\n";
    }

    private function validateIp($ip) {
        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
    }

    private function apiRequest($ip) {
        $protocol = $this->useTls ? 'https' : 'http';
        $url = "{$protocol}://{$this->apiHost}:{$this->apiPort}/api/lookup";

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['ip' => $ip]));
        curl_setopt($ch, CURLOPT_TIMEOUT, 120);

        // SSL/TLS options
        if ($this->useTls) {
            if (!$this->verifySsl) {
                // Disable SSL verification (use with caution - for self-signed certs)
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
            } else {
                // Enable SSL verification (recommended)
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            }
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if (curl_errno($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new Exception("API request failed: $error");
        }

        curl_close($ch);

        if ($httpCode !== 200) {
            throw new Exception("API returned error code: $httpCode");
        }

        $data = json_decode($response, true);
        if (!$data || !isset($data['success'])) {
            throw new Exception("Invalid API response");
        }

        if (!$data['success']) {
            throw new Exception($data['error'] ?? 'Unknown error');
        }

        return $data['data'];
    }

    private function filterResults($results) {
        if ($this->filter === 'all') {
            return $results;
        }

        return array_filter($results, function($result) {
            switch ($this->filter) {
                case 'listed':
                    return $result['listed'] === true;
                case 'clean':
                    return $result['listed'] === false;
                case 'error':
                    return $result['error'] !== null;
                default:
                    return true;
            }
        });
    }

    private function drawLine($widths) {
        echo '+';
        foreach ($widths as $width) {
            echo str_repeat('-', $width + 2) . '+';
        }
        echo "\n";
    }

    private function drawRow($columns, $widths, $colors = null) {
        echo '|';
        $i = 0;
        foreach ($columns as $col) {
            $padding = $widths[$i] - mb_strlen($col);
            $text = ' ' . $col . str_repeat(' ', $padding + 1);

            if ($colors && isset($colors[$i])) {
                $text = $this->color($text, $colors[$i]);
            }

            echo $text . '|';
            $i++;
        }
        echo "\n";
    }

    private function getStatusSymbol($result) {
        if ($result['error'] !== null) {
            return '!';
        } elseif ($result['listed']) {
            return '✗';
        } else {
            return '✓';
        }
    }

    private function getStatusColor($result) {
        if ($result['error'] !== null) {
            return 'yellow';
        } elseif ($result['listed']) {
            return 'red';
        } else {
            return 'green';
        }
    }

    private function getStatusText($result) {
        if ($result['error'] !== null) {
            return 'ERROR';
        } elseif ($result['listed']) {
            return 'LISTED';
        } else {
            return 'CLEAN';
        }
    }

    private function displayTable($data) {
        $results = $this->filterResults($data['results']);

        // Summary
        echo "\n";
        echo $this->color("RBL Lookup Results for: {$data['ip']}\n", 'bold');
        echo $this->color("Checked: {$data['timestamp']}\n", 'dim');
        echo "\n";

        echo "Summary: ";
        echo $this->color("{$data['listedCount']} Listed", 'red') . ' | ';
        echo $this->color("{$data['notListedCount']} Clean", 'green') . ' | ';
        echo $this->color("{$data['errorCount']} Errors", 'yellow') . ' | ';
        echo $this->color("{$data['totalChecked']} Total", 'blue');
        echo "\n\n";

        if (empty($results)) {
            echo "No results match the filter criteria.\n";
            return;
        }

        // Calculate column widths
        $widths = [
            3,  // Status symbol
            6,  // Status text
            30, // RBL Name
            35, // Host
            10, // Response Time
        ];

        // Adjust widths based on content
        foreach ($results as $result) {
            $widths[2] = max($widths[2], mb_strlen($result['name']));
            $widths[3] = max($widths[3], mb_strlen($result['host']));
        }

        // Draw table
        $this->drawLine($widths);
        $this->drawRow(
            ['', 'Status', 'RBL Name', 'Host', 'Time (ms)'],
            $widths,
            ['bold', 'bold', 'bold', 'bold', 'bold']
        );
        $this->drawLine($widths);

        foreach ($results as $result) {
            $symbol = $this->getStatusSymbol($result);
            $status = $this->getStatusText($result);
            $color = $this->getStatusColor($result);

            $this->drawRow(
                [
                    $symbol,
                    $status,
                    $result['name'],
                    $result['host'],
                    $result['responseTime'] . 'ms'
                ],
                $widths,
                [$color, $color, null, 'dim', null]
            );

            // Show error message if present
            if ($result['error']) {
                $errorMsg = '  Error: ' . $result['error'];
                echo '| ' . $this->color($errorMsg, 'yellow');
                $totalWidth = array_sum($widths) + (count($widths) * 3) - 3;
                echo str_repeat(' ', max(0, $totalWidth - mb_strlen($errorMsg))) . "|\n";
            }
        }

        $this->drawLine($widths);
        echo "\n";

        // Show filter info if active
        if ($this->filter !== 'all') {
            echo $this->color("Filter active: {$this->filter}\n", 'cyan');
            echo "Showing " . count($results) . " of {$data['totalChecked']} results\n\n";
        }
    }

    private function apiRequestCustom($method, $endpoint, $data = null) {
        if (!$this->apiKey) {
            throw new Exception("API key required. Add 'api-key = YOUR_KEY' to ~/.rbl-cli.rc");
        }

        $protocol = $this->useTls ? 'https' : 'http';
        $url = "{$protocol}://{$this->apiHost}:{$this->apiPort}{$endpoint}";

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);

        $headers = [
            'Content-Type: application/json',
            'X-API-Key: ' . $this->apiKey
        ];
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

        if ($data !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }

        curl_setopt($ch, CURLOPT_TIMEOUT, 30);

        // SSL/TLS options
        if ($this->useTls) {
            if (!$this->verifySsl) {
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
            } else {
                curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
                curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
            }
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if (curl_errno($ch)) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new Exception("API request failed: $error");
        }

        curl_close($ch);

        $result = json_decode($response, true);
        if (!$result) {
            throw new Exception("Invalid API response");
        }

        if ($httpCode >= 400) {
            $error = $result['error'] ?? "HTTP $httpCode error";
            throw new Exception($error);
        }

        return $result;
    }

    public function customAdd($cidr, $reason = null) {
        try {
            echo "Adding $cidr to custom RBL...\n";

            $result = $this->apiRequestCustom('POST', '/api/admin/custom-rbl/entries', [
                'network' => $cidr,
                'reason' => $reason
            ]);

            if ($result['success']) {
                echo $this->color("✓ Successfully added entry\n", 'green');
                echo "  Network: {$result['entry']['network']}\n";
                echo "  Reason: " . ($result['entry']['reason'] ?: 'None') . "\n";
                echo "  Entry ID: {$result['entry']['id']}\n";
            } else {
                echo $this->color("✗ Failed: {$result['error']}\n", 'red');
                exit(1);
            }
        } catch (Exception $e) {
            echo $this->color("Error: " . $e->getMessage() . "\n", 'red');
            exit(1);
        }
    }

    public function customRemove($cidr) {
        try {
            echo "Removing $cidr from custom RBL...\n";

            // First, list entries to find the ID
            $result = $this->apiRequestCustom('GET', '/api/admin/custom-rbl/entries?limit=1000');

            if (!$result['success']) {
                throw new Exception("Failed to list entries: " . ($result['error'] ?? 'Unknown error'));
            }

            $entryToDelete = null;
            foreach ($result['entries'] as $entry) {
                if ($entry['network'] === $cidr) {
                    $entryToDelete = $entry;
                    break;
                }
            }

            if (!$entryToDelete) {
                echo $this->color("✗ Entry not found: $cidr\n", 'red');
                exit(1);
            }

            $deleteResult = $this->apiRequestCustom('DELETE', "/api/admin/custom-rbl/entries/{$entryToDelete['id']}");

            if ($deleteResult['success']) {
                echo $this->color("✓ Successfully removed entry\n", 'green');
                echo "  Network: $cidr\n";
            } else {
                echo $this->color("✗ Failed: {$deleteResult['error']}\n", 'red');
                exit(1);
            }
        } catch (Exception $e) {
            echo $this->color("Error: " . $e->getMessage() . "\n", 'red');
            exit(1);
        }
    }

    public function customList($limit = 100) {
        try {
            echo "Fetching custom RBL entries...\n\n";

            $result = $this->apiRequestCustom('GET', "/api/admin/custom-rbl/entries?limit=$limit");

            if (!$result['success']) {
                throw new Exception($result['error'] ?? 'Unknown error');
            }

            $entries = $result['entries'];

            if (empty($entries)) {
                echo "No entries found.\n";
                return;
            }

            echo $this->color("Custom RBL Entries ({$result['total']} total)\n", 'bold');
            echo "\n";

            // Calculate column widths
            $widths = [8, 20, 40, 10];
            foreach ($entries as $entry) {
                $widths[1] = max($widths[1], mb_strlen($entry['network']));
                $widths[2] = max($widths[2], mb_strlen($entry['reason'] ?? ''));
            }

            // Draw table
            $this->drawLine($widths);
            $this->drawRow(
                ['ID', 'Network (CIDR)', 'Reason', 'Status'],
                $widths,
                ['bold', 'bold', 'bold', 'bold']
            );
            $this->drawLine($widths);

            foreach ($entries as $entry) {
                $status = $entry['listed'] ? 'LISTED' : 'DISABLED';
                $statusColor = $entry['listed'] ? 'red' : 'dim';

                $this->drawRow(
                    [
                        $entry['id'],
                        $entry['network'],
                        $entry['reason'] ?? '',
                        $status
                    ],
                    $widths,
                    [null, null, 'dim', $statusColor]
                );
            }

            $this->drawLine($widths);
            echo "\nShowing " . count($entries) . " of {$result['total']} entries\n\n";
        } catch (Exception $e) {
            echo $this->color("Error: " . $e->getMessage() . "\n", 'red');
            exit(1);
        }
    }

    public function customConfig($zoneName = null) {
        try {
            if ($zoneName) {
                echo "Updating custom RBL configuration...\n";

                $result = $this->apiRequestCustom('PUT', '/api/admin/custom-rbl/config', [
                    'zoneName' => $zoneName
                ]);

                if ($result['success']) {
                    echo $this->color("✓ Configuration updated\n", 'green');
                } else {
                    echo $this->color("✗ Failed: {$result['error']}\n", 'red');
                    exit(1);
                }
            }

            // Display current config
            $result = $this->apiRequestCustom('GET', '/api/admin/custom-rbl/config');

            if (!$result['success']) {
                throw new Exception($result['error'] ?? 'Unknown error');
            }

            $config = $result['config'];

            echo "\n" . $this->color("Custom RBL Configuration\n", 'bold');
            echo "  Zone Name: {$config['zone_name']}\n";
            echo "  Description: " . ($config['description'] ?? 'None') . "\n";
            echo "  Enabled: " . ($config['enabled'] ? 'Yes' : 'No') . "\n\n";
        } catch (Exception $e) {
            echo $this->color("Error: " . $e->getMessage() . "\n", 'red');
            exit(1);
        }
    }

    public function customApikeyGenerate($description = null) {
        try {
            echo "Generating new API key...\n";

            $result = $this->apiRequestCustom('POST', '/api/admin/api-keys', [
                'description' => $description
            ]);

            if ($result['success']) {
                echo "\n" . $this->color("✓ API Key Generated Successfully\n", 'green');
                echo "\n" . $this->color("IMPORTANT: Save this key now - it will not be shown again!\n", 'yellow');
                echo "\n";
                echo $this->color($result['apiKey'], 'bold') . "\n";
                echo "\n";
                echo "Key Prefix: {$result['keyPrefix']}\n";
                echo "Description: " . ($result['description'] ?: 'None') . "\n";
                echo "Created: {$result['createdAt']}\n";
                echo "\n";
                echo "Add to ~/.rbl-cli.rc:\n";
                echo "  api-key = {$result['apiKey']}\n\n";
            } else {
                echo $this->color("✗ Failed: {$result['error']}\n", 'red');
                exit(1);
            }
        } catch (Exception $e) {
            echo $this->color("Error: " . $e->getMessage() . "\n", 'red');
            exit(1);
        }
    }

    public function run($ip) {
        if (!$ip) {
            echo $this->color("Error: IP address is required\n", 'red');
            echo "Use --help for usage information\n";
            exit(1);
        }

        if (!$this->validateIp($ip)) {
            echo $this->color("Error: Invalid IPv4 address: $ip\n", 'red');
            exit(1);
        }

        try {
            echo "Querying RBL servers for $ip...\n";
            $data = $this->apiRequest($ip);

            if ($this->jsonOutput) {
                echo json_encode($data, JSON_PRETTY_PRINT) . "\n";
            } else {
                $this->displayTable($data);
            }
        } catch (Exception $e) {
            echo $this->color("Error: " . $e->getMessage() . "\n", 'red');
            exit(1);
        }
    }
}

// Main execution
if (php_sapi_name() !== 'cli') {
    die("This script must be run from the command line\n");
}

// Remove script name from args
$args = array_slice($argv, 1);

// Check for custom RBL commands
if (!empty($args) && $args[0] === 'custom') {
    array_shift($args); // Remove 'custom'

    if (empty($args)) {
        echo "Error: Custom command required\n";
        echo "Usage: php rbl-cli.php custom <command> [args]\n";
        echo "Commands: add, remove, list, config, apikey\n";
        exit(1);
    }

    $command = array_shift($args);

    // Extract options and positional args
    $options = [];
    $positional = [];

    foreach ($args as $arg) {
        if (strpos($arg, '--') === 0) {
            $options[] = $arg;
        } else {
            $positional[] = $arg;
        }
    }

    $cli = new RBLCli($options);

    switch ($command) {
        case 'add':
            if (empty($positional[0])) {
                echo "Error: CIDR required\n";
                echo "Usage: php rbl-cli.php custom add <cidr> [reason]\n";
                exit(1);
            }
            $cidr = $positional[0];
            $reason = isset($positional[1]) ? implode(' ', array_slice($positional, 1)) : null;
            $cli->customAdd($cidr, $reason);
            break;

        case 'remove':
            if (empty($positional[0])) {
                echo "Error: CIDR required\n";
                echo "Usage: php rbl-cli.php custom remove <cidr>\n";
                exit(1);
            }
            $cli->customRemove($positional[0]);
            break;

        case 'list':
            $limit = 100;
            foreach ($options as $opt) {
                if (strpos($opt, '--limit=') === 0) {
                    $limit = (int)substr($opt, 8);
                }
            }
            $cli->customList($limit);
            break;

        case 'config':
            $zoneName = null;
            foreach ($options as $opt) {
                if (strpos($opt, '--zone=') === 0) {
                    $zoneName = substr($opt, 7);
                }
            }
            $cli->customConfig($zoneName);
            break;

        case 'apikey':
            if (empty($positional[0]) || $positional[0] !== 'generate') {
                echo "Error: Use 'apikey generate' to create a new API key\n";
                exit(1);
            }
            $description = null;
            foreach ($options as $opt) {
                if (strpos($opt, '--desc=') === 0) {
                    $description = substr($opt, 7);
                }
            }
            $cli->customApikeyGenerate($description);
            break;

        default:
            echo "Error: Unknown custom command: $command\n";
            echo "Available commands: add, remove, list, config, apikey\n";
            exit(1);
    }

    exit(0);
}

// Regular RBL lookup mode
// Extract IP (first non-option argument)
$ip = null;
$options = [];

foreach ($args as $arg) {
    if (strpos($arg, '--') === 0 || strpos($arg, '-') === 0) {
        $options[] = $arg;
    } elseif (!$ip) {
        $ip = $arg;
    }
}

$cli = new RBLCli($options);
$cli->run($ip);
