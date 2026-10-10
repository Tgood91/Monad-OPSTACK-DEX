// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title VirtueFeeRouter
 * @notice Combines a Bushido virtue audit registry with dynamic cross-chain fee discounting.
 * @dev Locked to Base Mainnet (Chain ID 8453) intent routing logic.
 */
contract VirtueFeeRouter is AccessControl, ReentrancyGuard {
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    struct VirtueRecord {
        uint256 honorScore;      // e.g., 0 to 100 scale representing Bushido alignment
        bool isAuditPassed;      // Active standing in the registry
        uint256 lastUpdated;     // Timestamp of last score adjustment
    }

    // Mapping of trader/agent address to their virtue audit record
    mapping(address => VirtueRecord) public virtueRegistry;

    // Fee configuration (measured in basis points, e.g., 100 = 1%)
    uint256 public baseIntegratorFeeBps = 50;   // Default 0.50% fee for unranked or standard users
    uint256 public maxDiscountBps = 30;         // Maximum discount applied for elite virtue scores
    uint256 public requiredHonorThreshold = 80; // Minimum honor score required for discounts or execution

    // Events
    event VirtueScoreUpdated(address indexed target, uint256 honorScore, bool isAuditPassed);
    event IntentFeeCalculated(address indexed trader, uint256 finalFeeBps, uint256 discountApplied);

    constructor(address admin, address recorder) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);
        _grantRole(RECORDER_ROLE, recorder);
    }

    /**
     * @notice Records or updates a participant's Bushido virtue audit score.
     * @param target The wallet address of the agent or trader being audited.
     * @param honorScore The evaluated honor score (0-100).
     * @param isAuditPassed Whether the soul has passed the current audit.
     */
    function recordVirtueAudit(
        address target, 
        uint256 honorScore, 
        bool isAuditPassed
    ) external onlyRole(RECORDER_ROLE) {
        require(honorScore <= 100, "Virtue: Score cannot exceed 100");
        
        virtueRegistry[target] = VirtueRecord({
            honorScore: honorScore,
            isAuditPassed: isAuditPassed,
            lastUpdated: block.timestamp
        });

        emit VirtueScoreUpdated(target, honorScore, isAuditPassed);
    }

    /**
     * @notice Computes a dynamic cross-chain integrator fee based on the user's Bushido honor score.
     * @dev Higher honor scores scale down the integrator fee (e.g., rewarding virtuous agents/traders).
     * @param trader The address initiating the cross-chain intent.
     * @return finalFeeBps The adjusted fee in basis points to pass to Across/deBridge payload parameters.
     */
    function calculateDynamicFee(address trader) external view returns (uint256 finalFeeBps) {
        VirtueRecord memory record = virtueRegistry[trader];

        // If audit has not been passed or score is below threshold, return base fee without discount
        if (!record.isAuditPassed || record.honorScore < requiredHonorThreshold) {
            return baseIntegratorFeeBps;
        }

        // Scale discount linearly based on score surplus above threshold (threshold to 100)
        uint256 scoreAboveThreshold = record.honorScore - requiredHonorThreshold;
        uint256 maxSpan = 100 - requiredHonorThreshold;
        
        // Calculate proportional discount up to maxDiscountBps
        uint256 discount = (scoreAboveThreshold * maxDiscountBps) / maxSpan;

        if (discount > baseIntegratorFeeBps) {
            return 0; // Prevent negative fees, cap floor at 0
        }

        return baseIntegratorFeeBps - discount;
    }

    /**
     * @notice Validates a cross-chain intent execution gated by Bushido standards.
     * @param trader The trader/agent executing the intent.
     */
    function validateIntentExecution(address trader) external view {
        VirtueRecord memory record = virtueRegistry[trader];
        require(record.isAuditPassed, "Bushido: Soul audit failed or uninitialized");
        require(record.honorScore >= requiredHonorThreshold, "Bushido: Honor score below minimum execution threshold");
    }

    /// @notice Governor function to adjust fee parameters
    function setFeeParameters(
        uint256 _baseFeeBps, 
        uint256 _maxDiscountBps, 
        uint256 _threshold
    ) external onlyRole(GOVERNOR_ROLE) {
        require(_maxDiscountBps <= _baseFeeBps, "Fee: Discount cannot exceed base fee");
        require(_threshold <= 100, "Fee: Threshold must be <= 100");
        
        baseIntegratorFeeBps = _baseFeeBps;
        maxDiscountBps = _maxDiscountBps;
        requiredHonorThreshold = _threshold;
    }
}
