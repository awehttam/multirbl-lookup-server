#!/usr/bin/env php
<?php
/**
 * RBL Lookup CLI Tool
 *
 * Command-line tool to query the RBL API service and display results
 * in a nicely formatted text table.
 *
 * Usage: php rbl-cli.php <ip-address> [options]
 *
 * Options:
 *   --host=<host>     API server host (default: localhost)
 *   --port=<port>     API server port (default: 3000)
 *   --filter=<type>   Filter results: all, listed, clean, error (default: all)
 *   --no-color        Disable colored output
 *   --json            Output raw JSON instead of table
 *   --help            Show this help message
 *
 * Configuration File:
 *   Settings can be stored in ~/.rbl-cli.rc (INI format)
 *   Command-line options override config file settings
 */

class RBLCli {
    private $apiHost = 'localhost';
    private $apiPort = 3000;
    private $useColor = true;
    private $filter = 'all';
    private $jsonOutput = false;
    private $useTls = false;
    private $verifySsl = true;

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
